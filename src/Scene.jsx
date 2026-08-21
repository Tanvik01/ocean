import { useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { SEABED_Y, uniforms, sceneMaterial, view } from './shared.js'
import { envVert, envFrag, seabedVert, seabedFrag, snowVert, snowFrag } from './glsl.js'

/** Sky above the horizon, analytic infinite sea below it, abyss when submerged. */
function EnvironmentDome() {
  const ref = useRef()
  const material = useMemo(
    () => sceneMaterial(envVert, envFrag, { side: THREE.BackSide, depthWrite: false }),
    []
  )
  useFrame(({ camera }) => ref.current.position.copy(camera.position))

  return (
    <mesh ref={ref} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[3000, 32, 16]} />
    </mesh>
  )
}

/**
 * Only drawn while submerged. From above, the bottom is reached through the
 * water surface's refracted ray instead, which uses the same sand function.
 */
function Seabed() {
  const ref = useRef()
  const material = useMemo(() => sceneMaterial(seabedVert, seabedFrag), [])
  useFrame(({ camera }) => {
    ref.current.visible = camera.position.y < 0.5
  })

  return (
    <mesh ref={ref} material={material} rotation-x={-Math.PI / 2} position-y={SEABED_Y}>
      <planeGeometry args={[900, 900]} />
    </mesh>
  )
}

const BOX = 70

/** Marine snow — the only parallax cue once the seabed is out of view. */
function MarineSnow({ count = 3000 }) {
  const ref = useRef()
  const dpr = useThree((s) => s.viewport.dpr)

  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const seed = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * BOX
      pos[i * 3 + 1] = (Math.random() - 0.5) * BOX
      pos[i * 3 + 2] = (Math.random() - 0.5) * BOX
      seed[i] = Math.random()
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    return g
  }, [count])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: snowVert,
        fragmentShader: snowFrag,
        uniforms: {
          uTime: uniforms.uTime,
          uSnow: uniforms.uSnow,
          uCam: { value: new THREE.Vector3() },
          uBox: { value: BOX },
          uPixelRatio: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    []
  )
  material.uniforms.uPixelRatio.value = dpr

  useFrame(({ camera }) => {
    material.uniforms.uCam.value.copy(camera.position)
    ref.current.visible = view.underwater
  })

  return <points ref={ref} geometry={geometry} material={material} frustumCulled={false} />
}

export default function Scene() {
  return (
    <>
      <EnvironmentDome />
      <Seabed />
      <MarineSnow />
    </>
  )
}
