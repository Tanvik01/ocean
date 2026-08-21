import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { Simulation } from './Simulation.js'
import { SIZE, uniforms, sceneMaterial } from './shared.js'
import { waterVert, waterFrag } from './glsl.js'

const SEGMENTS = 160

export default function Water() {
  const gl = useThree((s) => s.gl)
  const sim = useMemo(() => new Simulation(gl), [gl])
  useEffect(() => () => sim.dispose(), [sim])

  const material = useMemo(
    () => sceneMaterial(waterVert, waterFrag, { side: THREE.DoubleSide }),
    []
  )

  // Seed a few drops so the surface is alive on the first frame.
  useEffect(() => {
    for (let i = 0; i < 9; i++) {
      sim.drop(0.25 + Math.random() * 0.5, 0.25 + Math.random() * 0.5, 0.05, 0.045)
    }
  }, [sim])

  const last = useRef(0)
  const ripple = (e) => {
    // On touch, dragging is the scroll gesture — only tap makes ripples.
    if (e.pointerType !== 'mouse' && e.type !== 'pointerdown') return
    const now = performance.now()
    if (now - last.current < 16) return
    last.current = now
    if (e.uv) sim.drop(e.uv.x, e.uv.y, 0.028, e.type === 'pointerdown' ? 0.09 : 0.035)
  }

  useFrame(() => {
    uniforms.uWater.value = sim.step()
    uniforms.uCaustics.value = sim.caustics.texture
  })

  return (
    <>
      <mesh rotation-x={-Math.PI / 2} material={material}>
        <planeGeometry args={[SIZE, SIZE, SEGMENTS, SEGMENTS]} />
      </mesh>
      {/*
        Pointer events raycast whatever geometry they're attached to. That used
        to be the dense display mesh above (SEGMENTS^2 * 2 triangles); every
        pointer move was a CPU hit-test against all of them. A 2-triangle
        plane at the same transform gives the same 0..1 uv sim.drop() wants,
        invisible so it never occludes the real surface (raycasting doesn't
        check .visible, only rendering does).
      */}
      <mesh
        visible={false}
        rotation-x={-Math.PI / 2}
        onPointerMove={ripple}
        onPointerDown={ripple}
      >
        <planeGeometry args={[SIZE, SIZE]} />
      </mesh>
    </>
  )
}
