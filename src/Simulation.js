import * as THREE from 'three'
import { SIZE, SEABED_Y, AMP, SIM_RES } from './shared.js'
import {
  simVert, dropFrag, updateFrag, normalFrag, causticVert, causticFrag,
} from './glsl.js'

const CAUSTIC_RES = 512
const CAUSTIC_GRID = 200

function target(res, clear) {
  const rt = new THREE.WebGLRenderTarget(res, res, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
  })
  rt.texture.generateMipmaps = false
  rt._clear = clear
  return rt
}

/**
 * evanw/webgl-water's height-field solver, plus its caustic projection.
 * Framework-free: React just calls step() once a frame.
 */
export class Simulation {
  constructor(renderer) {
    this.renderer = renderer
    this.a = target(SIM_RES, 0)
    this.b = target(SIM_RES, 0)

    this.scene = new THREE.Scene()
    this.camera = new THREE.Camera()
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2))
    this.quad.frustumCulled = false
    this.scene.add(this.quad)

    const delta = { value: new THREE.Vector2(1 / SIM_RES, 1 / SIM_RES) }
    const tex = { value: null }

    const pass = (fragmentShader, uniforms) =>
      new THREE.ShaderMaterial({ vertexShader: simVert, fragmentShader, uniforms, depthTest: false })

    this.drops = pass(dropFrag, {
      uTexture: tex,
      uCenter: { value: new THREE.Vector2() },
      uRadius: { value: 0.03 },
      uStrength: { value: 0.04 },
    })
    this.update = pass(updateFrag, { uTexture: tex, uDelta: delta })
    this.normal = pass(normalFrag, {
      uTexture: tex,
      uDelta: delta,
      uCell: { value: SIZE / SIM_RES },
      uAmp: { value: AMP },
    })
    this.tex = tex

    // Caustics: one grid drawn straight into clip space by its vertex shader.
    this.caustics = target(CAUSTIC_RES, 1)
    this.causticScene = new THREE.Scene()
    this.causticMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(SIZE, SIZE, CAUSTIC_GRID, CAUSTIC_GRID),
      new THREE.ShaderMaterial({
        vertexShader: causticVert,
        fragmentShader: causticFrag,
        uniforms: {
          uWater: tex,
          uAmp: { value: AMP },
          uSeabedY: { value: SEABED_Y },
          uSize: { value: SIZE },
        },
        depthTest: false,
        side: THREE.DoubleSide,
      })
    )
    this.causticMesh.frustumCulled = false
    this.causticScene.add(this.causticMesh)

    this.clear(this.a)
    this.clear(this.b)
    this.clear(this.caustics)
  }

  clear(rt) {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const prevColor = new THREE.Color()
    r.getClearColor(prevColor)
    const prevAlpha = r.getClearAlpha()
    r.setRenderTarget(rt)
    r.setClearColor(new THREE.Color(rt._clear, 0, 0), 1)
    r.clear(true, false, false)
    r.setRenderTarget(prevTarget)
    r.setClearColor(prevColor, prevAlpha)
  }

  /**
   * Render one full-screen pass into `this.b`, then swap. Restores whatever
   * target was bound: drop() is called from a pointer handler, and leaving a
   * 256x256 sim buffer bound sends the next scene render into it.
   */
  run(material) {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    this.tex.value = this.a.texture
    this.quad.material = material
    r.setRenderTarget(this.b)
    r.render(this.scene, this.camera)
    r.setRenderTarget(prevTarget)
    const t = this.a
    this.a = this.b
    this.b = t
  }

  /** u, v in [0,1] over the water patch. */
  drop(u, v, radius = 0.028, strength = 0.05) {
    this.drops.uniforms.uCenter.value.set(u, v)
    this.drops.uniforms.uRadius.value = radius
    this.drops.uniforms.uStrength.value = strength
    this.run(this.drops)
  }

  step() {
    const r = this.renderer
    const prevTarget = r.getRenderTarget()
    const prevColor = new THREE.Color()
    r.getClearColor(prevColor)
    const prevAlpha = r.getClearAlpha()

    this.run(this.update)
    this.run(this.update)
    this.run(this.normal)

    // Caustics baseline is 1.0 (undisturbed light), so clear to white.
    this.tex.value = this.a.texture
    r.setRenderTarget(this.caustics)
    r.setClearColor(0xffffff, 1)
    r.clear(true, false, false)
    r.render(this.causticScene, this.camera)

    r.setRenderTarget(prevTarget)
    r.setClearColor(prevColor, prevAlpha)
    return this.a.texture
  }

  dispose() {
    this.a.dispose()
    this.b.dispose()
    this.caustics.dispose()
    this.quad.geometry.dispose()
    this.causticMesh.geometry.dispose()
    ;[this.drops, this.update, this.normal, this.causticMesh.material].forEach((m) => m.dispose())
  }
}
