// All shader source. The simulation passes are a port of evanw/webgl-water
// (water.js, renderer.js); the sky / sea / underwater shading is written for
// this scene.

/* ------------------------------------------------------------------ *
 * 1. SIMULATION — 256x256 RGBA half-float: (height, velocity, n.x, n.z)
 * ------------------------------------------------------------------ */

export const simVert = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`

export const dropFrag = /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
uniform vec2  uCenter;
uniform float uRadius;
uniform float uStrength;
varying vec2 vUv;
const float PI = 3.141592653589793;

void main() {
  vec4 info = texture2D(uTexture, vUv);
  float drop = max(0.0, 1.0 - length(uCenter - vUv) / uRadius);
  drop = 0.5 - cos(drop * PI) * 0.5;
  info.r += drop * uStrength;
  gl_FragColor = info;
}
`

export const updateFrag = /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
uniform vec2 uDelta;
varying vec2 vUv;

void main() {
  vec4 info = texture2D(uTexture, vUv);
  vec2 dx = vec2(uDelta.x, 0.0);
  vec2 dy = vec2(0.0, uDelta.y);

  float average = (
    texture2D(uTexture, vUv - dx).r +
    texture2D(uTexture, vUv - dy).r +
    texture2D(uTexture, vUv + dx).r +
    texture2D(uTexture, vUv + dy).r
  ) * 0.25;

  info.g += (average - info.r) * 2.0;   // accelerate toward the neighbour mean
  info.g *= 0.995;                      // damping
  info.r += info.g;
  gl_FragColor = info;
}
`

// Normals are built in world units so the surface shader gets a physically sane
// slope: uCell is the world size of one texel, uAmp the height scale.
export const normalFrag = /* glsl */ `
precision highp float;
uniform sampler2D uTexture;
uniform vec2  uDelta;
uniform float uCell;
uniform float uAmp;
varying vec2 vUv;

void main() {
  vec4 info = texture2D(uTexture, vUv);
  float hx = texture2D(uTexture, vec2(vUv.x + uDelta.x, vUv.y)).r;
  float hy = texture2D(uTexture, vec2(vUv.x, vUv.y + uDelta.y)).r;

  vec3 dx = vec3(uCell, (hx - info.r) * uAmp, 0.0);
  vec3 dy = vec3(0.0,   (hy - info.r) * uAmp, uCell);
  info.ba = normalize(cross(dy, dx)).xz;
  gl_FragColor = info;
}
`

/* ------------------------------------------------------------------ *
 * 2. CAUSTICS — refract a light ray per grid vertex onto the seabed, shade by
 *    how much the projected area compressed. (renderer.js)
 * ------------------------------------------------------------------ */

export const causticVert = /* glsl */ `
uniform sampler2D uWater;
uniform float uAmp;
uniform float uSeabedY;   // negative
uniform float uSize;      // world size of the simulated patch
varying vec3 vOld;
varying vec3 vNew;

void main() {
  vec4 info = texture2D(uWater, uv);
  // local (x,y) -> world (x, h, -y): matches the water mesh's -PI/2 X rotation
  vec3 P = vec3(position.x, info.r * uAmp, -position.y);
  vec3 N = normalize(vec3(info.b, 1.0, info.a));

  // ponytail: the caustic light points straight down. The visual sun sits at
  // ~8deg, where refracted rays land ~300 units downrange and miss this texture
  // entirely; give it a real direction only if you also shift and enlarge the RT.
  vec3 L = vec3(0.0, -1.0, 0.0);
  vec3 T = refract(L, N, 1.0 / 1.333);

  float t = (uSeabedY - P.y) / T.y;
  vNew = P + T * t;
  vOld = vec3(position.x, uSeabedY, -position.y);

  gl_Position = vec4(vNew.xz / (uSize * 0.5), 0.0, 1.0);
}
`

export const causticFrag = /* glsl */ `
precision highp float;
varying vec3 vOld;
varying vec3 vNew;

void main() {
  float oldArea = length(dFdx(vOld)) * length(dFdy(vOld));
  float newArea = length(dFdx(vNew)) * length(dFdy(vNew));
  float ratio = oldArea / max(newArea, 1e-6);
  gl_FragColor = vec4(clamp(ratio, 0.0, 4.0), 0.0, 0.0, 1.0);
}
`

/* ------------------------------------------------------------------ *
 * 3. SHARED SCENE CHUNK — sky, sea shading, sand, fog. Included by the
 *    environment dome, the water surface and the seabed so the simulated patch
 *    and the infinite sea beyond it match exactly.
 * ------------------------------------------------------------------ */

export const common = /* glsl */ `
uniform vec3  uSunDir;
uniform float uTime;
uniform vec3  uFogColor;
uniform float uFogDensity;
uniform float uLight;        // 1 at the surface -> 0 in the deep
uniform float uSeabedY;
uniform float uSize;         // simulated patch size == caustic footprint
uniform sampler2D uCaustics;

const float ETA_IN  = 0.750188;  // air -> water
const float ETA_OUT = 1.333;     // water -> air

/* ---- sky -------------------------------------------------------- */
vec3 sunsetSky(vec3 d) {
  float h = max(d.y, 0.0);
  vec3 zenith = vec3(0.024, 0.050, 0.195);
  vec3 mid    = vec3(0.46,  0.185, 0.150);
  vec3 horiz  = vec3(1.12,  0.355, 0.100);

  vec3 col = mix(horiz, mid, smoothstep(0.0, 0.13, h));
  col = mix(col, zenith, pow(smoothstep(0.0, 0.70, h), 0.80));

  float sd = max(dot(d, uSunDir), 0.0);
  col += vec3(1.15, 0.40, 0.09) * pow(sd, 9.0)   * 0.80;  // warm halo near the sun
  col += vec3(1.70, 0.62, 0.14) * pow(sd, 220.0) * 2.40;  // tight glow
  col *= mix(1.0, 0.35, smoothstep(0.0, -0.20, d.y));
  return col;
}

vec3 sunDisc(vec3 d) {
  float c = dot(d, uSunDir);
  return vec3(11.0, 4.4, 1.2) * smoothstep(0.99915, 0.99965, c);
}

/**
 * The wind swell every water surface shares: the simulated patch adds its
 * ripples on top of this, the analytic sea beyond it uses it alone, so the two
 * meet without a seam. Returns (height, normal.x, normal.z); the fade argument
 * flattens the slope with distance to stop far-field sparkle aliasing.
 *
 * Three things keep it from reading as a lattice, which is what plain summed
 * sines always do:
 *   - headings step by the golden angle, so no two octaves ever line up;
 *   - each octave is sampled through the displacement of the ones above it, so
 *     crest lines meander instead of running dead straight;
 *   - sin is squared, giving peaked crests over broad flat troughs, which is
 *     the actual profile of a deep-water swell.
 * Speed follows the deep-water dispersion relation, w = sqrt(g*k): long waves
 * roll, short chop skitters.
 */
vec3 swell(vec2 q, float f) {
  float h = 0.0;
  vec2 g = vec2(0.0);
  vec2 warp = vec2(0.0);
  float a = 0.13, k = 0.30, ang = 0.62;

  for (int i = 0; i < 5; i++) {
    vec2 dir = vec2(cos(ang), sin(ang));
    float ph = dot(q + warp, dir) * k + uTime * sqrt(9.81 * k) * 0.42;
    float u = 0.5 + 0.5 * sin(ph);          // [0,1]
    h += a * (u * u - 0.375);               // 0.375 = mean of u^2, keeps h zero-mean
    g += dir * (k * a * u * cos(ph));       // d/dq of a*u^2
    warp += dir * a * u * 1.6;              // ponytail: warp ignored in g; the
                                            // slope error is well under the
                                            // shading noise at these amplitudes
    a *= 0.62; k *= 2.07; ang += 2.39996;
  }
  return vec3(h, -g * f);
}

/* ---- seabed ----------------------------------------------------- */
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i),                 hash21(i + vec2(1.0, 0.0)), f.x),
             mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 5; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}

// ponytail: the two fine octaves this used to add (+-0.22, +-0.035) shape a
// bump normal invisibly under this fog; dropping them cuts sandNormal (the
// only caller) from 9 fbm calls to 3 for no visible difference.
float sandHeight(vec2 q) {
  return fbm(q * 0.075) * 2.2;
}

vec3 sandNormal(vec2 q) {
  const float e = 0.5;
  float h = sandHeight(q);
  vec2 d = vec2(sandHeight(q + vec2(e, 0.0)) - h, sandHeight(q + vec2(0.0, e)) - h) * 3.0;
  return normalize(vec3(-d.x, e, -d.y));
}

vec3 sandColor(vec2 q) {
  float r = fbm(q * 0.22);
  float ripple = 0.5 + 0.5 * sin(q.x * 1.1 + fbm(q * 0.4) * 6.0);
  vec3 c = mix(vec3(0.30, 0.235, 0.155), vec3(0.68, 0.575, 0.395), r);
  return c * (0.78 + 0.22 * ripple);
}

float causticAt(vec2 q) {
  vec2 uvc = q / uSize + 0.5;
  float edge = smoothstep(0.0, 0.10, uvc.x) * smoothstep(1.0, 0.90, uvc.x)
             * smoothstep(0.0, 0.10, uvc.y) * smoothstep(1.0, 0.90, uvc.y);
  // the ratio is constant per grid triangle; blur away the facets
  vec2 o = vec2(1.4 / 512.0); // matches CAUSTIC_RES in Simulation.js
  float c = texture2D(uCaustics, uvc + vec2( o.x,  o.y)).r
          + texture2D(uCaustics, uvc + vec2(-o.x,  o.y)).r
          + texture2D(uCaustics, uvc + vec2( o.x, -o.y)).r
          + texture2D(uCaustics, uvc + vec2(-o.x, -o.y)).r;
  return mix(1.0, c * 0.25, edge);
}

vec3 applyFog(vec3 col, float dist) {
  return mix(uFogColor, col, exp(-dist * uFogDensity));
}

/** Sunlight columns raking down through the water column. */
float shafts(vec3 d) {
  if (d.y < 0.02) return 0.0;
  vec2 q = d.xz / max(d.y, 0.12);
  float n = fbm(q * 0.85 + vec2(uTime * 0.030, -uTime * 0.018));
  n = smoothstep(0.34, 0.78, n) * smoothstep(0.02, 0.35, d.y);
  return n * (0.30 + 0.70 * max(dot(d, uSunDir), 0.0));
}

/* ---- what a ray travelling down through the water sees ---------- */
vec3 underwaterLook(vec3 P, vec3 T, float extra) {
  vec3 deep = vec3(0.008, 0.048, 0.075);
  if (T.y > -0.02) return deep;
  float t = (uSeabedY - P.y) / T.y;
  // Past this the mix() below is already under 1% (exp(-85*0.055) ~ 0.01):
  // sandColor/causticAt would be spending texture reads and fbm on a colour
  // that gets thrown away, so bail before doing that work.
  if (t > 85.0) return deep;
  vec3 hit = P + T * t;
  vec3 sand = sandColor(hit.xz) * causticAt(hit.xz) * 0.9;
  return mix(deep, sand, exp(-(t + extra) * 0.055));
}

/* ---- the sea seen from above ------------------------------------ */
vec3 seaSurface(vec3 P, vec3 V, vec3 N, float dist) {
  vec3 R = reflect(V, N);
  R.y = abs(R.y);

  vec3 refl = sunsetSky(R);
  // glitter: sharp near the eye, broad in the distance (cheap roughness LOD)
  float lobe = mix(2200.0, 45.0, clamp(dist * 0.0045, 0.0, 1.0));
  refl += vec3(3.1, 1.20, 0.30) * pow(max(dot(R, uSunDir), 0.0), lobe) * 1.7;
  refl += sunDisc(R) * 0.55;

  vec3 T = refract(V, N, ETA_IN);
  vec3 body = underwaterLook(P, T, 0.0) * mix(0.25, 1.0, uLight);

  float F = 0.02 + 0.98 * pow(1.0 - max(dot(-V, N), 0.0), 5.0);
  vec3 col = mix(body, refl, clamp(F, 0.0, 1.0));

  // aerial perspective toward the horizon
  return mix(col, sunsetSky(vec3(V.x, 0.02, V.z)) * 0.88, 1.0 - exp(-dist * 0.0016));
}

/* ---- the sea seen from below: Snell window + total internal reflection ---- */
vec3 seaUnderside(vec3 P, vec3 V, vec3 N, float dist) {
  // N points down (into the water); V travels up toward the surface.
  vec3 R = reflect(V, N);
  vec3 mirror = underwaterLook(P, R, dist) * 0.65
              + vec3(0.26, 0.55, 0.66) * shafts(-R) * mix(0.045, 1.0, uLight) * 0.7;

  vec3 col = mirror;
  vec3 out_ = refract(V, N, ETA_OUT);
  if (dot(out_, out_) > 1e-6) {
    vec3 sky = (sunsetSky(out_) + sunDisc(out_)) * mix(0.05, 1.0, uLight);
    // Snell window: fade in over a couple of degrees past the critical angle
    // (cos 48.6deg = 0.6614) so the rim is not a stair-stepped hard edge.
    col = mix(mirror, sky, smoothstep(0.6614, 0.7250, clamp(dot(V, -N), 0.0, 1.0)));
  }

  col = applyFog(col, dist);
  col += vec3(0.34, 0.68, 0.78) * shafts(-V) * mix(0.02, 1.0, uLight) * 1.35;
  return col;
}
`

/* ------------------------------------------------------------------ *
 * 4. ENVIRONMENT DOME — sky plus an analytic infinite sea, so the horizon is at
 *    infinity and there is no skirt geometry to z-fight.
 * ------------------------------------------------------------------ */

export const envVert = /* glsl */ `
varying vec3 vWorld;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const envFrag = /* glsl */ `
precision highp float;
varying vec3 vWorld;

void main() {
  vec3 d = normalize(vWorld - cameraPosition);
  vec3 col;

  if (cameraPosition.y > 0.0) {
    if (d.y > 0.0) {
      col = sunsetSky(d) + sunDisc(d);
    } else {
      // analytic infinite sea: the horizon sits at true infinity, no skirt mesh
      float t = -cameraPosition.y / d.y;
      vec3 P = cameraPosition + d * t;
      vec3 sw = swell(P.xz, exp(-t * 0.0075));
      col = seaSurface(P, d, normalize(vec3(sw.y, 1.0, sw.z)), t);
    }
  } else if (d.y > 0.001) {
    float t = -cameraPosition.y / d.y;
    vec3 P = cameraPosition + d * t;
    vec3 sw = swell(P.xz, exp(-t * 0.02));
    col = seaUnderside(P, d, normalize(vec3(sw.y, -1.0, sw.z)), t);
  } else {
    col = uFogColor * (0.68 + 0.34 * smoothstep(-0.9, 0.1, d.y));
    col += vec3(0.34, 0.68, 0.78) * shafts(-d) * mix(0.02, 1.0, uLight) * 1.1;
  }

  gl_FragColor = vec4(col, 1.0);
}
`

/* ------------------------------------------------------------------ *
 * 5. WATER SURFACE — the simulated patch
 * ------------------------------------------------------------------ */

export const waterVert = /* glsl */ `
uniform sampler2D uWater;
uniform float uAmp;
varying vec3 vWorld;
varying vec2 vInfo;

void main() {
  vec4 info = texture2D(uWater, uv);
  // fade the sim out at the patch edge so it meets the analytic sea flush
  float edge = smoothstep(0.5, 0.33, length(uv - 0.5));
  vInfo = info.ba * edge;

  // local (x,y) -> world (x, h, -y), matching the mesh's -PI/2 X rotation
  vec3 p = position;
  p.z += info.r * uAmp * edge + swell(vec2(position.x, -position.y), 1.0).x;

  vec4 wp = modelMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const waterFrag = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec2 vInfo;

void main() {
  vec3 toEye = vWorld - cameraPosition;
  float dist = length(toEye);
  vec3 V = toEye / dist;

  vec3 sw = swell(vWorld.xz, exp(-dist * 0.0075));
  vec3 N = normalize(vec3(vInfo.x + sw.y, 1.0, vInfo.y + sw.z));

  vec3 col = gl_FrontFacing
    ? seaSurface(vWorld, V, N, dist)
    : seaUnderside(vWorld, V, -N, dist);

  gl_FragColor = vec4(col, 1.0);
}
`

/* ------------------------------------------------------------------ *
 * 6. SEABED + MARINE SNOW
 * ------------------------------------------------------------------ */

export const seabedVert = envVert

export const seabedFrag = /* glsl */ `
precision highp float;
varying vec3 vWorld;

void main() {
  float dist = length(vWorld - cameraPosition);
  float caustic = 1.0 + (causticAt(vWorld.xz) - 1.0) * (0.40 + 0.60 * uLight);
  // dune relief: without it the plane is a flat field with no form
  float lam = 0.22 + 0.78 * max(dot(sandNormal(vWorld.xz), normalize(vec3(0.58, 0.70, 0.42))), 0.0);
  vec3 c = sandColor(vWorld.xz) * caustic * lam * mix(0.40, 1.0, uLight);
  gl_FragColor = vec4(applyFog(c, dist), 1.0);
}
`

export const snowVert = /* glsl */ `
attribute float aSeed;
uniform float uTime;
uniform vec3  uCam;
uniform float uBox;
uniform float uPixelRatio;
varying float vFade;

void main() {
  vec3 p = position;
  p.y -= uTime * (0.12 + aSeed * 0.22);
  p.x += sin(uTime * 0.25 + aSeed * 37.0) * 0.7;
  p.z += cos(uTime * 0.21 + aSeed * 21.0) * 0.7;
  p = mod(p - uCam + uBox * 0.5, uBox) - uBox * 0.5 + uCam;

  vec4 mv = viewMatrix * vec4(p, 1.0);
  float d = -mv.z;
  vFade = smoothstep(uBox * 0.5, uBox * 0.14, d) * smoothstep(1.0, 5.0, d) * 0.5;
  gl_PointSize = clamp((1.0 + aSeed * 1.8) * (9.0 / max(d, 1.5)), 1.0, 6.0) * uPixelRatio;
  gl_Position = projectionMatrix * mv;
}
`

export const snowFrag = /* glsl */ `
precision highp float;
uniform float uSnow;
varying float vFade;

void main() {
  float r = length(gl_PointCoord - 0.5);
  if (r > 0.5) discard;
  float a = (1.0 - r * 2.0) * vFade * uSnow;
  gl_FragColor = vec4(vec3(0.72, 0.86, 0.95) * a, a);
}
`

/* ------------------------------------------------------------------ *
 * 7. SEABED PLANTING — instanced kelp blades and boulders. Both shade
 *    through the same caustic / light / fog terms as the seabed itself.
 * ------------------------------------------------------------------ */

// Blades are modelled standing on Y in [0,1] with the base at the origin; the
// instance matrix supplies height, width, heading and position.
export const kelpVert = /* glsl */ `
attribute float aSeed;
varying vec3  vWorld;
varying vec3  vNrm;
varying float vUp;
varying float vSeed;

void main() {
  float t = uv.y;                                   // 0 root -> 1 tip

  // The instance matrix carries a very non-uniform scale (a blade is ~0.1 wide
  // and up to 8 tall), so a bend written in local units comes out ten times too
  // small. Pull the axis scales back out and work in world units.
  float sx = length(instanceMatrix[0].xyz);
  float hgt = length(instanceMatrix[1].xyz);
  float sz = length(instanceMatrix[2].xyz);
  vec3 root = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

  // One slow current plus a faster flutter, both stiff at the root (t*t). Sway
  // goes as sqrt(height): taller blades lean further, but a 28m stalk does not
  // lean four times as far as a 7m one or it lies flat on the sand.
  float ph = uTime * (0.45 + aSeed * 0.35) + dot(root.xz, vec2(0.21, 0.17)) + aSeed * 31.0;
  // the +0.5 is a standing lean: the bed is in a current, not still water
  float bend = (sin(ph) * 0.52 + sin(ph * 1.73 + 1.3) * 0.30 + 0.5) * t * t * sqrt(hgt) * 0.90;
  float lean = 0.55 + aSeed * 0.9;                  // each blade has its own heading

  vec3 p = position;
  // Leaf profile: narrow at the holdfast, widest around the middle, pointed at
  // the tip. Both axes — the blade is two crossed quads, so one of them is thin
  // in z and tapering only x leaves it a rectangle.
  p.xz *= (0.70 + 0.50 * sin(t * 3.14159)) * (1.0 - pow(t, 3.0) * 0.86);
  p.x += bend * lean / sx;
  p.z += bend * (1.2 - lean) / sz;
  p.y -= bend * bend * 0.16 / hgt;                  // a bent blade is no longer

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNrm = normalize(mat3(instanceMatrix) * normal);
  vUp = t;
  vSeed = aSeed;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const kelpFrag = /* glsl */ `
precision highp float;
varying vec3  vWorld;
varying vec3  vNrm;
varying float vUp;
varying float vSeed;

void main() {
  float dist = length(vWorld - cameraPosition);
  // abs(): the blades are double-sided, so both faces catch the same light
  float lam = 0.40 + 0.60 * abs(dot(vNrm, normalize(vec3(0.32, 0.80, 0.50))));

  vec3 tone = mix(vec3(0.085, 0.180, 0.105), vec3(0.210, 0.430, 0.205), vSeed);
  vec3 c = tone * mix(0.35, 1.0, vUp) * lam;        // dark at the root, open at the tip
  c *= 0.45 + 0.55 * causticAt(vWorld.xz);
  c *= mix(0.38, 1.0, uLight);
  c += vec3(0.16, 0.34, 0.26) * pow(vUp, 3.0) * mix(0.30, 1.0, uLight) * 0.55;
  gl_FragColor = vec4(applyFog(c, dist), 1.0);
}
`

// Boulders reuse the seabed's own sand palette so they read as the same ground.
export const rockVert = /* glsl */ `
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormalW = normalize(mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const rockFrag = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNormalW;

void main() {
  float dist = length(vWorld - cameraPosition);
  float lam = 0.20 + 0.80 * max(dot(vNormalW, normalize(vec3(0.35, 0.88, 0.32))), 0.0);
  vec3 c = sandColor(vWorld.xz * 3.0) * vec3(0.62, 0.68, 0.70);   // cooler and darker than sand
  c *= lam * mix(0.42, 1.0, uLight);
  c *= 0.7 + 0.3 * causticAt(vWorld.xz);
  gl_FragColor = vec4(applyFog(c, dist), 1.0);
}
`

/* ------------------------------------------------------------------ *
 * 8. FISH — instanced schools. Geometry and per-vertex colour come from a
 *    merged GLTF mesh (see Fish.jsx); the swim itself is a body wave baked
 *    into the vertex shader rather than the source file's own skeletal
 *    animation, which is what makes a whole school one draw call.
 * ------------------------------------------------------------------ */

export const fishVert = /* glsl */ `
attribute float aSeed;
attribute vec3 color;
varying vec3 vWorld;
varying vec3 vNrm;
varying vec3 vColor;

void main() {
  // The instance matrix carries each fish's own (non-uniform) scale; undo it
  // so the swim amplitude below is a constant in world units, not shrunk or
  // exaggerated per instance the way the kelp bend was before it accounted
  // for this (see kelpVert).
  float sx = length(instanceMatrix[0].xyz);

  // Body is normalised to run along +Z, nose at +0.5, tail at -0.5 (see
  // normalizeFishGeometry in Fish.jsx). mask keeps the head rigid and lets
  // the tail sweep, the way a real fish swims from the spine back.
  float mask = smoothstep(0.5, -0.5, position.z);
  float ph = uTime * (3.0 + aSeed * 1.6) + aSeed * 23.0;
  float sway = sin(ph - position.z * 3.4) * mask * mask;

  vec3 p = position;
  p.x += sway * 0.15 / sx;
  p.y += sin(ph * 0.6 + aSeed) * 0.018 * mask;

  vec3 n = normal;
  n.x += sway * 0.5 * mask;

  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vWorld = wp.xyz;
  vNrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vColor = color;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const fishFrag = /* glsl */ `
precision highp float;
varying vec3 vWorld;
varying vec3 vNrm;
varying vec3 vColor;
uniform float uFade; // 0 fully present -> 1 dissolved into the fog colour

void main() {
  float dist = length(vWorld - cameraPosition);
  vec3 n = normalize(vNrm);
  float lam = 0.35 + 0.65 * max(dot(n, normalize(vec3(0.35, 0.85, 0.30))), 0.0);
  // The source model's own vertex colours carry the pattern (stripes, eyes);
  // a light dark-back / pale-belly term on top of that is what still reads as
  // "fish" once fog and low uLight have taken most of the colour out.
  float countershade = smoothstep(-0.2, 0.6, n.y);
  vec3 c = vColor * mix(0.6, 1.05, countershade) * lam;
  c *= 0.55 + 0.45 * causticAt(vWorld.xz);
  c *= mix(0.22, 1.0, uLight);
  c = mix(c, uFogColor, uFade);
  gl_FragColor = vec4(applyFog(c, dist), 1.0);
}
`
