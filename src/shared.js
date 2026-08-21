import * as THREE from 'three'
import { common } from './glsl.js'

// Scene constants. SIZE is the simulated water patch *and* the caustic
// footprint — the two must match or the caustics land in the wrong place.
export const SIZE = 40
export const SEABED_Y = -40
export const AMP = 6.0 // sim height (~0.03) -> world units
export const SIM_RES = 256

// Sun sits just above the horizon, down -Z, which is where the camera looks.
export const SUN_DIR = new THREE.Vector3(0.06, 0.135, -1).normalize()

const SHALLOW = new THREE.Color(0.085, 0.235, 0.265) // just under the surface
const MID = new THREE.Color(0.014, 0.075, 0.125)
const ABYSS = new THREE.Color(0.013, 0.042, 0.062) // dim blue-green, not black:
// the descent now ends *in* the kelp, and a pitch-black forest is not a view

// One uniform object graph, shared by reference across every material in the
// scene: writing `uniforms.uLight.value` updates all of them at once.
export const uniforms = {
  uTime: { value: 0 },
  uSunDir: { value: SUN_DIR },
  uFogColor: { value: SHALLOW.clone() },
  uFogDensity: { value: 0.006 },
  uLight: { value: 1 },
  uSeabedY: { value: SEABED_Y },
  uSize: { value: SIZE },
  uCaustics: { value: null },
  uWater: { value: null },
  uAmp: { value: AMP },
  uSnow: { value: 0 },
}

// Mutable scene state, written by Rig each frame and read by anything that
// needs it outside of a shader (mesh visibility, effect strength).
export const view = { depth: 0, underwater: false, progress: 0 }

/**
 * A material wired to the shared uniforms, with the common GLSL chunk prepended
 * to its fragment shader. Every surface in the scene is built this way, so the
 * simulated patch, the analytic sea and the seabed all shade identically.
 */
export function sceneMaterial(vertexShader, fragmentShader, extra = {}) {
  // extra.uniforms are per-material additions (e.g. a fade the fish schools
  // don't share) merged onto the shared graph rather than replacing it — each
  // shared entry is still the same `{value}` object, so uTime etc. keep
  // updating this material too.
  const { uniforms: extraUniforms, ...rest } = extra
  return new THREE.ShaderMaterial({
    vertexShader: common + vertexShader,
    fragmentShader: common + fragmentShader,
    uniforms: extraUniforms ? { ...uniforms, ...extraUniforms } : uniforms,
    ...rest,
  })
}

const c = new THREE.Color()
export function setDepth(depth) {
  const k = THREE.MathUtils.clamp(depth / -SEABED_Y, 0, 1)
  c.copy(SHALLOW).lerp(MID, THREE.MathUtils.smoothstep(k, 0.0, 0.45))
  uniforms.uFogColor.value.copy(c).lerp(ABYSS, THREE.MathUtils.smoothstep(k, 0.35, 0.95))
  uniforms.uFogDensity.value = THREE.MathUtils.lerp(0.006, 0.062, k)
  uniforms.uLight.value = Math.exp(-depth * 0.042)
  uniforms.uSnow.value = THREE.MathUtils.smoothstep(k, 0.02, 0.2)
}
