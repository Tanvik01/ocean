import { useLayoutEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { sceneMaterial, uniforms, view } from './shared.js'
import { fishVert, fishFrag } from './glsl.js'

const tmpColor = new THREE.Color()

/**
 * Every source glb is several sibling mesh primitives (body / stripes / eyes,
 * one material each) skinned to one armature. The swim here is a shader wave
 * (fishVert), not the rig, so this bakes each primitive's rest-pose geometry
 * plus its material colour into one static, merged mesh: one draw call per
 * school instead of one skinned mesh per fish.
 *
 * Body is recentred and scaled so it runs along Z, nose to tail, spanning
 * [-0.5, 0.5] — Z is the long axis on all four source files, but the rest
 * pose itself faces -Z (confirmed by render: default came out swimming
 * tail-first), hence FishSchool's `flip` defaults true rather than false.
 */
function normalizeFishGeometry(scene, flip) {
  scene.updateMatrixWorld(true)
  const parts = []
  scene.traverse((o) => {
    if (!o.isMesh) return
    const g = o.geometry.clone()
    if (g.index) g.toNonIndexed()
    g.applyMatrix4(o.matrixWorld) // bakes the armature's rest pose + the -90deg Z-up->Y-up node rotation
    for (const key of Object.keys(g.attributes)) {
      if (key !== 'position' && key !== 'normal') g.deleteAttribute(key)
    }
    const count = g.attributes.position.count
    const col = new Float32Array(count * 3)
    tmpColor.copy(o.material.color)
    for (let i = 0; i < count; i++) tmpColor.toArray(col, i * 3)
    g.setAttribute('color', new THREE.BufferAttribute(col, 3))
    parts.push(g)
  })

  const merged = mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())

  merged.computeBoundingBox()
  const size = merged.boundingBox.getSize(new THREE.Vector3())
  merged.center()
  const s = 1 / size.z
  merged.scale(s, s, s)
  // A pure rotation, not a mirrored (negative) scale: mirroring one axis
  // flips triangle winding, which would need the normals re-derived from
  // reversed winding too. Rotating leaves winding and normals both correct.
  if (flip) merged.rotateY(Math.PI)
  return merged
}

function useFishGeometry(url, flip) {
  const { scene } = useGLTF(url)
  return useMemo(() => normalizeFishGeometry(scene, flip), [scene, flip])
}

const m4 = new THREE.Matrix4()
const q = new THREE.Quaternion()
const pos = new THREE.Vector3()
const scl = new THREE.Vector3()
const UP = new THREE.Vector3(0, 1, 0)

/**
 * One school: a fixed swarm of instances (set once, jittered inside a home
 * volume) carried by a single group that circles a centre point. Individual
 * life comes from the shader's per-instance swim phase (aSeed), not from
 * moving each instance separately — that is what keeps a few hundred fish to
 * one instanced draw call plus one animated transform.
 */
function FishSchool({
  url,
  // All four Quaternius rigs share one export pipeline (same -90deg node
  // rotation, same Main1..Main6 bone chain) and, confirmed by render, all
  // rest-pose with the nose at -Z rather than +Z — hence true, not false.
  flip = true,
  count,
  scale,
  jitter = 0.35,
  spread = 1.6,
  center,
  radius,
  speed,
  bob = 0.6,
  bandNear,
  bandFar,
}) {
  const geometry = useFishGeometry(url, flip)
  const material = useMemo(
    () => sceneMaterial(fishVert, fishFrag, { side: THREE.DoubleSide, uniforms: { uFade: { value: 1 } } }),
    []
  )
  const meshRef = useRef()
  const groupRef = useRef()
  const phase = useRef(Math.random() * Math.PI * 2).current

  useLayoutEffect(() => {
    const seeds = new Float32Array(count)
    for (let i = 0; i < count; i++) {
      const r = Math.sqrt(Math.random()) * spread
      const a = Math.random() * Math.PI * 2
      pos.set(Math.cos(a) * r, (Math.random() - 0.5) * spread * 0.5, Math.sin(a) * r)
      const s = scale * (1 + (Math.random() - 0.5) * jitter)
      scl.set(s, s, s)
      q.setFromAxisAngle(UP, Math.random() * Math.PI * 2)
      meshRef.current.setMatrixAt(i, m4.compose(pos, q, scl))
      seeds[i] = Math.random()
    }
    meshRef.current.instanceMatrix.needsUpdate = true
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1))
  }, [count, geometry, jitter, scale, spread])

  useFrame((_, delta) => {
    const a = uniforms.uTime.value * speed + phase
    groupRef.current.position.set(
      center[0] + Math.cos(a) * radius,
      center[1] + Math.sin(a * 1.7 + phase) * bob,
      center[2] + Math.sin(a) * radius
    )
    // Tangent of a pure circle x=cos(a)R, z=sin(a)R is (-sin a, cos a); with
    // the body normalised to face +Z, rotation.y = -a points it that way.
    groupRef.current.rotation.y = -a
    groupRef.current.rotation.z = Math.sin(a) * 0.10

    const dt = Math.min(delta, 1 / 20)
    const target = view.depth > bandNear && view.depth < bandFar ? 0 : 1
    const u = material.uniforms.uFade
    u.value = THREE.MathUtils.damp(u.value, target, 2.5, dt)
    groupRef.current.visible = u.value < 0.995
  })

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, count]}
        frustumCulled={false}
      />
    </group>
  )
}

export default function Fish() {
  return (
    <>
      {/* Baitfish, just under the surface. */}
      <FishSchool
        url="/fish.glb"
        count={220}
        scale={0.14}
        jitter={0.4}
        spread={2.6}
        center={[1, -7, 5]}
        radius={7}
        speed={0.5}
        bandNear={1}
        bandFar={13}
      />
      {/* The stretch between the surface light and the kelp bed, otherwise empty. */}
      <FishSchool
        url="/fish.glb"
        count={140}
        scale={0.17}
        jitter={0.35}
        spread={4.5}
        center={[-1, -19, 1]}
        radius={11}
        speed={0.30}
        bandNear={11}
        bandFar={27}
      />
      {/* Reef fish, milling loosely around the kelp bed. */}
      <FishSchool
        url="/clownfish.glb"
        count={35}
        scale={0.12}
        jitter={0.3}
        spread={3.5}
        center={[3, -30, -6]}
        radius={5}
        speed={0.22}
        bandNear={25}
        bandFar={40}
      />
      <FishSchool
        url="/butterflyfish.glb"
        count={35}
        scale={0.15}
        jitter={0.3}
        spread={3.5}
        center={[-4, -31, -10]}
        radius={6}
        speed={0.18}
        bandNear={25}
        bandFar={40}
      />
      {/* A solitary swordfish crossing the mid column for scale and drama. */}
      <FishSchool
        url="/swordfish.glb"
        count={1}
        scale={3.2}
        jitter={0}
        spread={0}
        center={[0, -20, -4]}
        radius={16}
        speed={0.12}
        bandNear={13}
        bandFar={30}
      />
    </>
  )
}

useGLTF.preload('/fish.glb')
useGLTF.preload('/clownfish.glb')
useGLTF.preload('/butterflyfish.glb')
useGLTF.preload('/swordfish.glb')
