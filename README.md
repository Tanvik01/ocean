# Golden Hour

evanw's [webgl-water](https://github.com/evanw/webgl-water) height-field simulation and caustics,
ported to React Three Fiber and dropped into an evening sea. Gulls work the swell above, schools of
fish thread the whole water column, and scroll carries you from the surface down through the light,
past the fish, to the kelp on the bottom.

```bash
npm install
npm run dev
```

Drag across the water to make ripples (tap on touch — dragging is the scroll gesture there). Scroll
up anywhere in the top 20% of the descent and it eases the rest of the way back to the surface on its
own — scroll down again at any point and you get your scroll back immediately.

## How it works

**`src/Simulation.js`** — the port. Two 256² RGBA half-float targets ping-pong `(height, velocity,
normal.x, normal.z)` through three passes each frame: `drop` (cosine-falloff disturbance), `update`
(accelerate toward the neighbour mean, damp 0.995), `normal`. Caustics are a second target: a 200×200
grid whose vertex shader refracts a light ray through the surface normal, intersects the seabed, and
emits the hit point as its clip position; the fragment shades by how much the projected area
compressed. Framework-free — React only calls `step()`.

**`src/glsl.js`** — every shader. `swell()` is the wind chop every water surface shares. Plain
summed sines always read as a lattice — regular hexagon-ish cells — because a handful of plane waves
at near-perpendicular headings tile the plane. Three things break it: headings step by the golden
angle so no two octaves ever align, each octave samples through the displacement of the ones above it
so crest lines meander instead of running straight, and `sin` is squared to give peaked crests over
broad troughs. Phase speed follows the deep-water dispersion relation `w = sqrt(g*k)`, so long swell
rolls and short chop skitters instead of everything drifting at one speed. The `common` chunk is prepended to both stages of every scene
material, so the simulated patch, the analytic sea beyond it and the seabed all shade through the
same `sunsetSky`, `swell`, `sandColor` and fog functions and cannot drift apart.

**The horizon is analytic.** The environment dome shades sky above the horizon and ray-marches an
infinite water plane below it, so there is no skirt mesh, no z-fighting, and the sea meets the sky at
true infinity. The 40×40 simulated patch simply draws on top of it in the middle.

**Underwater is the same shader inverted.** `seaUnderside` refracts out through the flipped normal,
falls back to a dark mirror on total internal reflection, and cross-fades the two over a couple of
degrees at the critical angle — that is Snell's window, torn into lobes by the ripples.

**`src/Seabed.jsx`** — the planting. 1400 kelp blades and 90 boulders, one `InstancedMesh` each,
scattered from a fixed seed so the camera keyframes can be tuned against the result. A blade is two
crossed quads (so it never vanishes edge-on), tapered to a leaf profile and bent in the vertex shader
by `t*t` — stiff at the holdfast, loose at the tip — on a slow current, a faster flutter and a
standing lean. The instance matrix carries a wildly non-uniform scale (0.1 wide, up to 29 tall), so
the shader pulls the axis scales back out and does the bend in world units; skip that and every blade
comes out a rigid slab. About 7% are giant kelp reaching two thirds of the way up the water column —
they are the only thing in frame through the middle of the descent, and they are pushed clear of the
camera corridor so none of them ends up a green wall across the lens. Both shade through the same
`causticAt`, `uLight` and `applyFog` terms as the seabed, so they sit in the same water.

**`src/Seagulls.jsx`** — the four skinned gulls from `seagulls_animated.glb`, flown as one flock on a
banked circle. The file is a Sketchfab FBX export in unknown units, so the scale is measured from the
bounding box at load rather than hardcoded. They climb away and fade out between 10% and 24% scroll,
as the camera goes under.

**Darkness is one lerp.** `setDepth()` in `src/shared.js` drives fog colour, fog density and a light
scalar off camera depth; every material reads the same uniform objects by reference. The bottom of
that lerp is a dim blue-green rather than black — the descent now ends *in* the kelp, and there is
nothing to explore in a bed you cannot see.

**`src/Fish.jsx`** — five schools threading the column: two of the same baitfish (just under the
surface, then the stretch that used to be empty between there and the kelp), two reef species milling
near the bed, and a solitary swordfish crossing the middle depths. Each source `.glb` is several
skinned mesh primitives (body / stripes / eyes, one colour each) sharing one armature; since the swim
here is a shader wave rather than the rig, `normalizeFishGeometry` bakes every primitive's rest pose
plus its material colour into one static, vertex-coloured mesh, so a whole school is one
`InstancedMesh` and one draw call instead of one skinned mesh per fish. Instance transforms are set
once (a fixed swarm jittered inside a home volume); a single parent group carries the whole school
around a circle each frame, `rotation.y = -a` keeping it pointed along the tangent, so movement stays
to one animated transform no matter how many fish are in the school. All four rigs turned out to rest-
pose facing -Z rather than +Z (`FishSchool`'s `flip` default), caught by rendering one flipped and one
not side by side rather than by trusting the axis math. Each school fades to the fog colour outside its
own depth band instead of a hard cut, and `sceneMaterial`'s `extra.uniforms` (see below) is what lets
its fade uniform live alongside the shared scene graph.

**Fish models** are CC0 (public domain) by Quaternius, via [Poly Pizza](https://poly.pizza) —
`fish.glb`, `clownfish.glb`, `butterflyfish.glb`, `swordfish.glb` in `public/`. No attribution is
required, but credit where it's due.

**`sceneMaterial()`'s `extra.uniforms`** (in `src/shared.js`) merges onto the shared uniform graph
instead of replacing it — every entry the caller doesn't override is still the exact same `{value}`
object used everywhere else, so `uTime`/`uFogColor`/etc. keep updating a material that also adds its
own uniforms (Fish's per-school `uFade`). Before this, a material needing an extra uniform had to
either forgo the shared graph or hand-roll its uniforms object from scratch (see `MarineSnow` in
`Scene.jsx`, which does exactly that for two keys).

**The scroll return.** `Rig.jsx` watches `scroll.scroll.current` — drei's raw, undamped scroll target,
taken straight from `el.scrollTop` — rather than a separate wheel/touch listener: an upward flick
while it's still under 0.20 arms a return, any downward move cancels it, and while armed the same
`el.scrollTop` is what gets eased toward 0, feeding straight back into drei's own scroll bookkeeping
instead of fighting it. The camera's own follow damping was tightened at the same time (it was
stacked behind drei's 0.25s scroll spring, adding its own lag on top; now it settles faster than the
spring drives it, so drei's spring is the one thing setting the pace).

**Frame budget.** `<PerformanceMonitor>` (`App.jsx`) samples fps and drives `setDpr` directly —
drei's `<AdaptiveDpr>` assumes something is already calling r3f's own `regress()`, which nothing here
does, so it would sit inert without this. Water's pointer handlers used to raycast the full display
mesh (256 segments a side, now 160) on every pointer move; they now hit an invisible 2-triangle plane
at the same transform instead (raycasting doesn't check `.visible`, only rendering does). `sandNormal`
dropped from 9 `fbm` calls to 3 by building the bump from the coarse octave alone — the fine ones were
shaping a normal no one could see under this fog. `underwaterLook` bails out of `sandColor`/
`causticAt` past the distance where its own `mix()` already discards them. The caustic render target
dropped from 1024² to 512² — `causticAt`'s blur offset in `glsl.js` is tuned to match, the two have to
move together or the facet-blur goes wrong.

## Deliberate simplifications

- The caustic light points straight down. The visual sun sits at ~8°, where refracted rays would land
  ~300 units downrange and miss the caustic texture entirely (see the `ponytail:` note in
  `causticVert`). Giving it a real direction means shifting and enlarging that render target.
- No volumetric god-rays pass — the shafts are a procedural term in the water column shader.
- The seabed is a flat plane bump-shaded from noise rather than displaced geometry — so the kelp and
  boulders are planted at a constant `SEABED_Y` rather than following the dunes.
- `swell()` warps each octave's sample position by the ones above it but does not carry that warp
  through to the analytic gradient. The slope error is well under the shading noise at these
  amplitudes; carrying it means a Jacobian per octave.
- The gulls are one flock on a circle, not individually steered boids; the fish schools are the same
  idea (one circling group per school) rather than per-fish steering or real flocking/schooling
  behaviour.
- Fish don't avoid the kelp, the boulders, or each other — instances are placed once and never
  re-checked against the scenery, so an unlucky seed can park a fish inside a kelp blade.
