import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { SEABED_Y, sceneMaterial, view } from './shared.js'
import { kelpVert, kelpFrag, rockVert, rockFrag } from './glsl.js'

const KELP = 1400
const ROCKS = 90
const FIELD = 34 // kelp stays inside the caustic footprint and the camera's path

// Deterministic scatter — a fixed seed means the same forest every reload, so
// the camera keyframes in Rig can be tuned against it.
function rand(s) {
  return () => {
    s = (s * 16807) % 2147483647
    return s / 2147483647
  }
}

const m = new THREE.Matrix4()
const q = new THREE.Quaternion()
const pos = new THREE.Vector3()
const scl = new THREE.Vector3()

/** Kelp blades: crossed quads so they never vanish edge-on, bent in the current. */
function Kelp() {
  const ref = useRef()

  const geometry = useMemo(() => {
    const blade = new THREE.PlaneGeometry(1, 1, 1, 10).translate(0, 0.5, 0)
    const g = mergeGeometries([blade, blade.clone().rotateY(Math.PI / 2)])
    blade.dispose()
    const seeds = new Float32Array(KELP)
    for (let i = 0; i < KELP; i++) seeds[i] = Math.random()
    g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
    return g
  }, [])

  const material = useMemo(
    () => sceneMaterial(kelpVert, kelpFrag, { side: THREE.DoubleSide }),
    []
  )

  useLayoutEffect(() => {
    const r = rand(20250821)
    for (let i = 0; i < KELP; i++) {
      // clumped: pick a clump centre, then jitter — even scatter reads as a lawn
      const cx = (r() - 0.5) * 2 * FIELD
      const cz = (r() - 0.5) * 2 * FIELD
      const n = 1 + r() * 2.2
      let x = cx + (r() - 0.5) * 4 * n
      const z = cz + (r() - 0.5) * 4 * n
      // ~7% are giant kelp reaching most of the way up the water column: they
      // are the only thing in frame through the middle of the descent
      const h = r() < 0.07 ? 14 + r() * 15 : 1.6 + Math.pow(r(), 2) * 6.5
      // A giant right on the lens is a green wall, not a plant. Short blades
      // still brush past the camera, which is the point of flying this low.
      if (h > 12 && Math.abs(x) < 8 && z > -20 && z < 6) x += x < 0 ? -8 : 8
      pos.set(x, SEABED_Y - 0.15, z)
      scl.set(0.09 + r() * 0.17, h, 1)
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI * 2)
      ref.current.setMatrixAt(i, m.compose(pos, q, scl))
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [])

  useFrame(() => {
    ref.current.visible = view.underwater
  })

  return <instancedMesh ref={ref} args={[geometry, material, KELP]} frustumCulled={false} />
}

/** Boulders, so the kelp has something to grow around. */
function Rocks() {
  const ref = useRef()
  const geometry = useMemo(() => new THREE.IcosahedronGeometry(1, 1), [])
  const material = useMemo(() => sceneMaterial(rockVert, rockFrag), [])

  useLayoutEffect(() => {
    const r = rand(777)
    for (let i = 0; i < ROCKS; i++) {
      const s = 0.5 + Math.pow(r(), 2) * 3.2
      let x = (r() - 0.5) * 2.4 * FIELD
      const z = (r() - 0.5) * 2.4 * FIELD
      // Keep the corridor the camera flies down clear — a boulder through the
      // lens at the end of the descent reads as a bug, not as a boulder.
      if (Math.abs(x) < 9 && z > -22 && z < 5) x += x < 0 ? -9 : 9
      pos.set(x, SEABED_Y + s * 0.35, z)
      scl.set(s, s * (0.45 + r() * 0.4), s * (0.7 + r() * 0.5))
      q.setFromEuler(new THREE.Euler(r() * 0.6, r() * 6.28, r() * 0.6))
      ref.current.setMatrixAt(i, m.compose(pos, q, scl))
    }
    ref.current.instanceMatrix.needsUpdate = true
  }, [])

  useFrame(() => {
    ref.current.visible = view.underwater
  })

  return <instancedMesh ref={ref} args={[geometry, material, ROCKS]} frustumCulled={false} />
}

export default function SeabedLife() {
  return (
    <>
      <Rocks />
      <Kelp />
    </>
  )
}
