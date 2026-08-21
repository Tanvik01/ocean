import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { EffectComposer, Bloom, Vignette, ToneMapping } from '@react-three/postprocessing'
import { Effect, ToneMappingMode, BlendFunction } from 'postprocessing'
import * as THREE from 'three'
import { view } from './shared.js'

const frag = /* glsl */ `
uniform float uStrength;
uniform float uTime;

void mainUv(inout vec2 uv) {
  uv.x += sin(uv.y * 13.0 + uTime * 1.5) * 0.0030 * uStrength;
  uv.y += cos(uv.x * 10.0 + uTime * 1.1) * 0.0026 * uStrength;
}

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = mix(inputColor.rgb, inputColor.rgb * vec3(0.80, 0.97, 1.14), uStrength * 0.75);
  c *= 1.0 - length(uv - 0.5) * 0.55 * uStrength;
  outputColor = vec4(c, inputColor.a);
}
`

class UnderwaterEffect extends Effect {
  constructor() {
    super('UnderwaterEffect', frag, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map([
        ['uStrength', new THREE.Uniform(0)],
        ['uTime', new THREE.Uniform(0)],
      ]),
    })
  }
}

export default function Effects() {
  const effect = useMemo(() => new UnderwaterEffect(), [])
  const t = useRef(0)

  useFrame((_, delta) => {
    t.current += delta
    effect.uniforms.get('uTime').value = t.current
    const target = view.underwater ? THREE.MathUtils.clamp(view.depth / 6, 0.35, 1) : 0
    const u = effect.uniforms.get('uStrength')
    u.value = THREE.MathUtils.damp(u.value, target, 6, Math.min(delta, 0.05))
  })

  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={1.05} luminanceSmoothing={0.25} intensity={0.85} />
      <primitive object={effect} />
      <Vignette offset={0.28} darkness={0.75} />
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  )
}
