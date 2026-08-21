import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useScroll } from '@react-three/drei'
import * as THREE from 'three'
import { uniforms, view, setDepth } from './shared.js'

const RETURN_ZONE = 0.20   // scroll offset below which an upward flick auto-returns
const RETURN_LAMBDA = 5    // ~0.6s to settle (1 - e^-5*0.6 = 0.95)

/** Piecewise-linear keyframes: key(p, [[at, value], ...]) */
function key(p, stops) {
  if (p <= stops[0][0]) return stops[0][1]
  for (let i = 1; i < stops.length; i++) {
    const [a, va] = stops[i - 1]
    const [b, vb] = stops[i]
    if (p <= b) return THREE.MathUtils.lerp(va, vb, (p - a) / (b - a))
  }
  return stops[stops.length - 1][1]
}

// The descent. 0 -> glide over the golden water; ~0.20 -> punch through the
// surface; down past the last of the light to the sand, then a level traverse
// forward through the kelp field rather than a landing.
const CAM_Y = [[0, 2.8], [0.10, 2.3], [0.18, 0.35], [0.24, -0.15], [0.32, -3.5], [0.55, -12], [0.72, -22], [0.84, -29], [1, -31.5]]
const CAM_Z = [[0, 15], [0.18, 9], [0.35, 4.5], [0.72, 0], [1, -17]]
const CAM_X = [[0, 2.2], [0.35, -0.8], [0.72, 0.6], [1, -6]]
// Where to look, as an offset from the camera's own height.
const LOOK_DY = [[0, -0.32], [0.18, -0.9], [0.30, 13.0], [0.46, 9.0], [0.62, 3.0], [0.82, -2.0], [0.90, -5.0], [1, -4.2]]

const pos = new THREE.Vector3()
const look = new THREE.Vector3()

export default function Rig() {
  const scroll = useScroll()
  const started = useRef(false)
  const prevRaw = useRef(0)
  const returning = useRef(false)
  const hud = useRef(null)
  const hudText = useRef('')

  useEffect(() => {
    hud.current = document.getElementById('depth')
  }, [])

  useFrame(({ camera }, delta) => {
    const dt = Math.min(delta, 1 / 20)
    uniforms.uTime.value += dt

    // Auto-return to the surface: an upward flick while still near the top
    // eases the rest of the way there on its own, instead of needing to
    // scroll back through the whole zone by hand. Driven off scroll.scroll
    // (drei's raw, undamped target straight from el.scrollTop) rather than a
    // separate wheel/touch listener, so it reacts the same way to a mouse
    // wheel, a touch drag or a scrollbar grab, and writing el.scrollTop below
    // feeds straight back into that same value via drei's own scroll handler.
    const raw = scroll.scroll.current
    const movingUp = raw < prevRaw.current - 1e-5
    const movingDown = raw > prevRaw.current + 1e-5
    prevRaw.current = raw
    if (movingUp && raw < RETURN_ZONE) returning.current = true
    else if (movingDown) returning.current = false

    if (returning.current) {
      const el = scroll.el
      el.scrollTop = THREE.MathUtils.damp(el.scrollTop, 0, RETURN_LAMBDA, dt)
      if (el.scrollTop < 0.5) returning.current = false
    }

    const p = scroll.offset
    view.progress = p
    pos.set(key(p, CAM_X), key(p, CAM_Y), key(p, CAM_Z))

    if (!started.current) {
      camera.position.copy(pos)
      started.current = true
    } else {
      // Heavy, water-like follow rather than snapping to the scrollbar —
      // but tight enough that it doesn't add its own lag on top of drei's
      // own 0.25s scroll spring. Faster still while the surface return is
      // easing the scroll itself, so the camera doesn't trail behind it.
      const l = returning.current ? 14 : 8
      camera.position.x = THREE.MathUtils.damp(camera.position.x, pos.x, l, dt)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, pos.y, l, dt)
      camera.position.z = THREE.MathUtils.damp(camera.position.z, pos.z, l, dt)
    }

    look.set(0, camera.position.y + key(p, LOOK_DY), camera.position.z - 12)
    camera.lookAt(look)

    view.depth = Math.max(0, -camera.position.y)
    view.underwater = camera.position.y < 0
    setDepth(view.depth)

    const text = view.underwater ? `${view.depth.toFixed(1)} m` : 'surface'
    if (text !== hudText.current) {
      hudText.current = text
      if (hud.current) hud.current.textContent = text
    }
  })

  return null
}
