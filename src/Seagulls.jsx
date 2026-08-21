import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF, useAnimations } from '@react-three/drei'
import * as THREE from 'three'
import { SUN_DIR, view } from './shared.js'

const URL = '/seagulls_animated.glb'
const RADIUS = 22
const CENTRE = [0, 7.5, -26] // ahead of the camera, which looks down -Z
const SPAN = 16 // world size to normalise the flock to, whatever the file's units are

/**
 * The four gulls that ship in the glb, flown as one flock on a slow banked
 * circle out over the swell. They are the only thing above the waterline, so
 * they carry the sense of scale before the descent starts.
 */
export default function Seagulls() {
  const group = useRef()
  const { scene, animations } = useGLTF(URL)
  const { actions } = useAnimations(animations, group)

  // Sketchfab exports arrive in whatever unit the source used; measure once.
  const fit = useMemo(() => {
    const size = new THREE.Box3().setFromObject(scene).getSize(new THREE.Vector3())
    return SPAN / Math.max(size.length(), 1e-4)
  }, [scene])

  useEffect(() => {
    Object.values(actions).forEach((a) => {
      a.reset().play()
      a.timeScale = 1.15
    })
  }, [actions])

  useFrame(() => {
    const g = group.current
    // Once the camera is through the surface there is nothing to see; the flock
    // also climbs away as the descent begins rather than popping out.
    const fade = 1 - THREE.MathUtils.smoothstep(view.progress, 0.10, 0.24)
    g.visible = fade > 0.01

    const a = view.progress * 2.2 + performance.now() * 0.00006
    g.position.set(
      CENTRE[0] + Math.cos(a) * RADIUS,
      CENTRE[1] + (1 - fade) * 26 + Math.sin(a * 2.3) * 1.1,
      CENTRE[2] + Math.sin(a) * RADIUS
    )
    // Face along the tangent of the circle, banking into the turn.
    g.rotation.set(0, -a + Math.PI, -0.22)
  })

  return (
    <>
      <hemisphereLight args={['#ffd9b0', '#12283a', 1.6]} />
      <directionalLight position={SUN_DIR.clone().multiplyScalar(300).toArray()} intensity={3.2} color="#ffb073" />
      <group ref={group} scale={fit}>
        <primitive object={scene} />
      </group>
    </>
  )
}

useGLTF.preload(URL)
