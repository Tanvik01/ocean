import { Suspense } from 'react'
import { Canvas, useThree } from '@react-three/fiber'
import { ScrollControls, Scroll, PerformanceMonitor } from '@react-three/drei'
import * as THREE from 'three'
import Scene from './Scene.jsx'
import Water from './Water.jsx'
import SeabedLife from './Seabed.jsx'
import Seagulls from './Seagulls.jsx'
import Fish from './Fish.jsx'
import Rig from './Rig.jsx'
import Effects from './Effects.jsx'
import Overlay from './Overlay.jsx'

/**
 * PerformanceMonitor only samples fps and reports a 0..1 factor; it does not
 * touch the renderer itself (that's what drei's AdaptiveDpr assumes r3f's own
 * regress() system did, which nothing here triggers) — so this drives
 * dpr directly off that factor instead.
 */
function DprManager() {
  const setDpr = useThree((s) => s.setDpr)
  return <PerformanceMonitor onChange={({ factor }) => setDpr(THREE.MathUtils.lerp(0.8, 1.75, factor))} />
}

export default function App() {
  return (
    <>
      <Canvas
        dpr={[1, 1.75]}
        camera={{ fov: 55, near: 0.05, far: 8000, position: [2.2, 2.8, 15] }}
        gl={{
          antialias: false, // the composer resolves; MSAA on an HDR buffer is wasted
          powerPreference: 'high-performance',
          toneMapping: THREE.NoToneMapping, // done at the end of the composer
        }}
      >
        <DprManager />
        <Suspense fallback={null}>
          <ScrollControls pages={7} damping={0.25}>
            <Scene />
            <SeabedLife />
            <Seagulls />
            <Fish />
            <Water />
            <Rig />
            <Scroll html style={{ width: '100%' }}>
              <Overlay />
            </Scroll>
          </ScrollControls>
          <Effects />
        </Suspense>
      </Canvas>
      <div className="hud">
        <span className="hud-label">depth</span>
        <span id="depth">surface</span>
      </div>
    </>
  )
}
