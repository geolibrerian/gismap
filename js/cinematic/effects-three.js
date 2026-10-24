// three.js renderers for the cinematic visual effects (see cinematic-effects.js
// for the catalogue and geometry). Every effect is a ShaderMaterial whose size
// is set in screen pixels each frame, so a glow is the same width at zoom 4 and
// zoom 16, and whose motion reads one continuous clock, so stepping to the next
// observation never restarts a flame or a ripple. Newly observed features
// (`fresh`) flare when they appear; older ones in a build-up settle down.
import { CINEMATIC_EFFECTS, effectFields, effectFrame, effectParts, particleSeeds, quadBuffers, ribbonBuffers } from "./cinematic-effects.js?v=0.2.0";

const EPOCH = globalThis.performance?.now?.() ?? 0;
let externalClock = null;
const nowSeconds = () => (externalClock ? externalClock() : ((globalThis.performance?.now?.() ?? Date.now()) - EPOCH) / 1000);

/**
 * Drive every effect from `clock()` (seconds) instead of the wall clock, e.g.
 * so a movie export renders frame f at exactly f / fps; null restores real
 * time. While set, effects stop asking the map to repaint on their own.
 */
export function setEffectClock(clock) {
  externalClock = typeof clock === "function" ? clock : null;
}

const NOISE = /* glsl */ `
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return v;
}
vec3 fireRamp(float heat) {
  vec3 col = mix(vec3(0.5, 0.04, 0.02), vec3(0.98, 0.3, 0.03), smoothstep(0.0, 0.45, heat));
  col = mix(col, vec3(1.0, 0.68, 0.16), smoothstep(0.45, 0.8, heat));
  return mix(col, vec3(1.0, 0.93, 0.7), smoothstep(0.88, 1.0, heat));
}`;

// Premultiplied output: rgb carries colour × alpha, and alpha < coverage makes
// the light partly additive. That keeps a glow saturated on a pale basemap
// (pure additive washes orange out to white) yet luminous on a dark one.
const OUTPUT = "gl_FragColor = vec4(col * a, a * (1.0 - uAdd));";

const RIBBON_VERTEX = /* glsl */ `
attribute vec2 aOffset; attribute float aSide, aDist, aFresh, aSeed, aSize;
uniform float uPx, uWidth;
varying float vSide, vDistPx, vFresh, vSeed;
void main() {
  vec3 p = position;
  // A ring smaller than the ribbon on screen would draw as crossed sticks; fade it in as it grows.
  float visible = smoothstep(1.0, 3.0, aSize / (uWidth * uPx));
  p.xy += aOffset * aSide * uWidth * uPx * visible;
  vSide = aSide; vDistPx = aDist / uPx; vFresh = aFresh * visible; vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const WALL_VERTEX = /* glsl */ `
attribute float aSide, aDist, aFresh, aSeed, aSize;
uniform float uPx, uHeight, uSince;
varying float vUp, vDistPx, vFresh, vSeed;
void main() {
  vec3 p = position;
  float up = aSide * 0.5 + 0.5;
  float flare = 1.0 + 0.9 * aFresh * exp(-uSince * 0.9);
  float visible = smoothstep(4.0, 24.0, aSize / uPx);
  p.z += up * uHeight * uPx * mix(0.4, 1.0, aFresh) * flare * visible;
  vUp = up; vDistPx = aDist / uPx; vFresh = aFresh; vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const QUAD_VERTEX = /* glsl */ `
attribute vec2 aCorner; attribute float aMagnitude, aHeading, aSpeed, aFresh, aSeed;
uniform float uPx, uRadius, uStretch;
varying vec2 vCorner; varying float vMagnitude, vSpeed, vFresh, vSeed;
void main() {
  vec3 p = position;
  float radius = uRadius * (0.9 + aMagnitude * 1.8) * (1.0 + 0.5 * aFresh);
  vec2 q = vec2(aCorner.x * radius * (1.0 + uStretch * (0.8 + aSpeed)), aCorner.y * radius);
  float c = cos(aHeading), s = sin(aHeading);
  p.xy += vec2(q.x * c - q.y * s, q.x * s + q.y * c) * uPx;
  vCorner = aCorner; vMagnitude = aMagnitude; vSpeed = aSpeed; vFresh = aFresh; vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const FRAGMENTS = {
  // A soft Gaussian halo around a bright core, breathing slowly, with light
  // drifting along the line. A newly observed outline flashes and widens.
  glow: /* glsl */ `
varying float vSide, vDistPx, vFresh, vSeed;
void main() {
  float d = abs(vSide);
  float flash = vFresh * exp(-uSince * 1.3);
  float breathe = 0.8 + 0.2 * sin(uTime * 1.6 + vSeed * 6.283);
  float drift = 0.55 + 0.45 * sin(vDistPx / 80.0 - uTime * 2.2);
  float halo = exp(-d * d * (6.0 - 3.5 * flash));
  float core = smoothstep(0.17, 0.02, d);
  vec3 col = mix(uColor, vec3(1.0, 0.95, 0.88), core * 0.6 + flash * 0.25);
  float a = (halo * 0.7 * breathe * drift + core * 0.9) * mix(0.45, 1.0, vFresh) * (1.0 + flash) * uIntensity * uOpacity;
  a = clamp(a, 0.0, 1.0);
  ${OUTPUT}
}`,
  // The burning edge at ground level: flickering heat along the line.
  fireEdge: /* glsl */ `
varying float vSide, vDistPx, vFresh, vSeed;
void main() {
  float d = abs(vSide);
  float flick = fbm(vec2(vDistPx / 18.0, uTime * 2.4 + vSeed * 13.0));
  float heat = (exp(-d * d * 30.0) * 0.6 + exp(-d * d * 5.0) * 0.3) * (0.45 + 0.75 * flick);
  heat *= mix(0.5, 1.0, vFresh);
  vec3 col = mix(vec3(0.45, 0.04, 0.02), fireRamp(clamp(heat, 0.0, 0.85)), vFresh * 0.7 + 0.3);
  float a = clamp(heat * 1.5, 0.0, 1.0) * uIntensity * uOpacity;
  ${OUTPUT}
}`,
  // Flame tongues on a curtain standing on the edge: two octaves of noise
  // scrolling upward, cut by height, with uneven heights along the line.
  fireWall: /* glsl */ `
varying float vUp, vDistPx, vFresh, vSeed;
void main() {
  // Tongues sway more the higher they reach.
  float x = vDistPx / 20.0 + sin(vUp * 5.0 - uTime * 3.0 + vDistPx * 0.01) * 0.25 * vUp;
  // Each column of the curtain gets its own, constantly changing height.
  float column = noise(vec2(x * 1.2, uTime * 0.9 + vSeed * 5.0)) * 0.65 + noise(vec2(x * 3.3 + 3.1, uTime * 1.7)) * 0.35;
  float height = min(0.92, 0.1 + 1.25 * pow(column, 1.8));
  float n = fbm(vec2(x * 1.8, vUp * 2.6 - uTime * 2.4));
  float flame = 1.0 - vUp / max(height, 0.05) + (n - 0.5) * 0.9;
  float heat = clamp(flame * 1.2, 0.0, 1.0);
  vec3 col = fireRamp(heat * 0.92 + n * 0.08);
  float a = smoothstep(0.08, 0.5, heat) * smoothstep(1.0, 0.72, vUp) * uIntensity * uOpacity;
  ${OUTPUT}
}`,
  // Comets running along the line in its drawn order over a faint base line.
  flow: /* glsl */ `
varying float vSide, vDistPx, vFresh, vSeed;
void main() {
  float d = abs(vSide);
  float gust = uGust > 0.5 ? 0.6 + 0.8 * noise(vec2(vSeed * 9.0, uTime * 0.6)) : 1.0;
  float phase = fract((vDistPx - uTime * uSpeed * gust) / uSpacing + vSeed);
  // A long fading tail behind a bright head; the head is hot white at the centre line.
  float comet = pow(phase, 2.6) * smoothstep(1.0, 0.975, phase);
  float head = smoothstep(0.82, 0.97, phase) * smoothstep(1.0, 0.975, phase);
  float across = exp(-d * d * (4.0 + 10.0 * (1.0 - comet)));
  float base = exp(-d * d * 14.0) * 0.3;
  vec3 col = mix(uColor, vec3(1.0), clamp(head * smoothstep(0.45, 0.0, d), 0.0, 1.0) * 0.9);
  float a = clamp(comet * across * 1.3 + head * 0.6 * across + base, 0.0, 1.0) * mix(0.5, 1.0, vFresh) * uIntensity * uOpacity;
  ${OUTPUT}
}`,
  // Rings travel out from the point; a newly observed point sends one strong
  // shockwave. Colour follows magnitude (amber → red → magenta).
  pulse: /* glsl */ `
varying vec2 vCorner; varying float vMagnitude, vSpeed, vFresh, vSeed;
void main() {
  float r = length(vCorner);
  if (r > 1.0) discard;
  vec3 ramp = mix(vec3(1.0, 0.5, 0.06), vec3(0.95, 0.12, 0.08), smoothstep(0.0, 0.6, vMagnitude));
  ramp = mix(ramp, vec3(0.85, 0.08, 0.45), smoothstep(0.65, 1.0, vMagnitude));
  vec3 base = uPalette > 0.5 ? uColor : ramp;
  float rings = 0.0;
  for (int k = 0; k < 3; k++) {
    float phase = fract(uTime * uRate * (0.7 + vMagnitude * 0.6) + float(k) / 3.0 + vSeed);
    float width = 0.05 + 0.08 * phase;
    float ring = (r - phase) / width;
    rings += exp(-ring * ring) * pow(1.0 - phase, 1.2);
  }
  rings *= mix(0.65, 1.0, vFresh);
  float spread = clamp(uSince * 0.6, 0.0, 1.0);
  float front = (r - spread) / 0.07;
  float shock = vFresh * exp(-front * front) * (1.0 - spread) * 2.2;
  float core = exp(-r * r * 70.0) * (0.85 + 1.2 * vFresh * exp(-uSince * 2.0));
  float halo = exp(-r * r * 10.0) * 0.3 * mix(0.6, 1.0, vFresh);
  vec3 col = mix(base, vec3(1.0, 0.98, 0.94), clamp(core * 0.7 + shock * 0.25, 0.0, 1.0));
  float a = clamp(rings * 1.2 + shock + core + halo, 0.0, 1.0) * uIntensity * uOpacity;
  ${OUTPUT}
}`,
  // A soft breathing spot under a point.
  spot: /* glsl */ `
varying vec2 vCorner; varying float vMagnitude, vSpeed, vFresh, vSeed;
void main() {
  float r = length(vCorner);
  if (r > 1.0) discard;
  float flash = vFresh * exp(-uSince * 1.4);
  float breathe = 0.78 + 0.22 * sin(uTime * 1.8 + vSeed * 6.283);
  float halo = exp(-r * r * (7.0 - 3.0 * flash)) * breathe;
  float core = exp(-r * r * 90.0);
  vec3 col = mix(uColor, vec3(1.0, 0.97, 0.92), core * 0.8 + flash * 0.3);
  float a = clamp((halo * 0.7 + core) * mix(0.45, 1.0, vFresh) * (1.0 + flash), 0.0, 1.0) * uIntensity * uOpacity;
  ${OUTPUT}
}`,
  // Streaks in lanes blowing downwind, faster for higher speeds, in gusts.
  wind: /* glsl */ `
varying vec2 vCorner; varying float vMagnitude, vSpeed, vFresh, vSeed;
void main() {
  float s = vCorner.x * 0.5 + 0.5;
  float a = 0.0;
  float gust = 0.55 + 0.45 * noise(vec2(vSeed * 17.0, uTime * 0.5));
  for (int k = 0; k < 6; k++) {
    float fk = float(k);
    float lane = (hash(vec2(fk, vSeed * 31.0)) * 2.0 - 1.0) * 0.75;
    float speed = 0.28 + vSpeed * 0.75 + hash(vec2(fk, 3.1)) * 0.2;
    float head = fract(uTime * speed + hash(vec2(fk, 7.7) + vSeed)) * 1.5 - 0.15;
    float tail = 0.22 + 0.25 * vSpeed;
    float t = (s - (head - tail)) / tail;
    float streak = smoothstep(0.0, 1.0, t) * smoothstep(head + 0.015, head - 0.01, s);
    float across = (vCorner.y - lane) / (0.045 + 0.02 * vSpeed);
    float thick = exp(-across * across);
    a += streak * thick;
  }
  a *= smoothstep(0.0, 0.18, s) * smoothstep(1.0, 0.8, s) * gust * mix(0.4, 1.0, vFresh);
  vec3 col = mix(uColor, vec3(0.92, 0.98, 1.0), clamp(a - 0.4, 0.0, 1.0));
  a = clamp(a, 0.0, 1.0) * uIntensity * uOpacity;
  ${OUTPUT}
}`,
  // Moving caustic ridges over a deep-to-shallow tint.
  water: /* glsl */ `
varying vec2 vPx; varying float vFresh;
void main() {
  vec2 q = vPx / 110.0;
  float n = fbm(q + vec2(uTime * 0.05, uTime * 0.035));
  float n2 = fbm(q * 1.8 - vec2(uTime * 0.045, -uTime * 0.06) + n * 1.4);
  float ridge = pow(1.0 - abs(n2 * 2.0 - 1.0), 7.0);
  vec3 col = mix(uColor * 0.6, mix(uColor, vec3(0.62, 0.9, 1.0), 0.4), n) + ridge * vec3(0.8, 0.96, 1.0) * 0.7;
  float rise = mix(1.0, smoothstep(0.0, 1.4, uSince), vFresh);
  float a = clamp((0.28 + ridge * 0.42) * mix(0.55, 1.0, vFresh) * rise, 0.0, 1.0) * uIntensity * uOpacity;
  gl_FragColor = vec4(col * a, a);
}`,
};

const COMMON_UNIFORMS = "uniform float uTime, uSince, uPx, uOpacity, uIntensity, uAdd, uSpeed, uSpacing, uGust, uRate, uPalette;\nuniform vec3 uColor;\n";

function material(THREE, uniforms, vertexShader, fragment, overrides = {}) {
  const own = Object.fromEntries(Object.entries(overrides).map(([key, value]) => [key, { value: key === "uColor" ? new THREE.Color(value) : value }]));
  return new THREE.ShaderMaterial({
    uniforms: { ...uniforms, ...own },
    vertexShader,
    fragmentShader: `${COMMON_UNIFORMS}${NOISE}\n${FRAGMENTS[fragment]}`,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });
}

function geometry(THREE, buffers, attributes) {
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(buffers.position, 3));
  for (const [name, [key, size]] of Object.entries(attributes)) result.setAttribute(name, new THREE.Float32BufferAttribute(buffers[key], size));
  if (buffers.index) result.setIndex(buffers.index);
  result.userData.lngLat = buffers.lngLat;
  return result;
}

const RIBBON_ATTRIBUTES = { aOffset: ["offset", 2], aSide: ["side", 1], aDist: ["distance", 1], aFresh: ["fresh", 1], aSeed: ["seed", 1], aSize: ["size", 1] };
const QUAD_ATTRIBUTES = { aCorner: ["corner", 2], aMagnitude: ["magnitude", 1], aHeading: ["heading", 1], aSpeed: ["speed", 1], aFresh: ["fresh", 1], aSeed: ["seed", 1] };

function emberPoints(THREE, uniforms, seeds) {
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(seeds.position, 3));
  result.setAttribute("aSeed", new THREE.Float32BufferAttribute(seeds.seed, 2));
  result.userData.lngLat = seeds.lngLat;
  const shader = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
attribute vec2 aSeed;
uniform float uTime, uPx, uHeight, uDpr;
varying float vLife, vTwinkle;
void main() {
  float life = fract(uTime * (0.16 + aSeed.x * 0.22) + aSeed.y);
  vec3 p = position;
  p.z += life * uHeight * 2.4 * uPx;
  p.x += (sin(uTime * 1.3 + aSeed.y * 40.0) * 0.6 + (aSeed.x - 0.5)) * life * 30.0 * uPx;
  p.y += cos(uTime * 1.1 + aSeed.x * 40.0) * 0.6 * life * 30.0 * uPx;
  gl_PointSize = mix(4.0, 1.4, life) * uDpr;
  vLife = life; vTwinkle = 0.55 + 0.45 * sin(uTime * 13.0 + aSeed.x * 91.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: /* glsl */ `
uniform float uOpacity, uIntensity;
varying float vLife, vTwinkle;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 col = mix(vec3(1.0, 0.9, 0.5), vec3(1.0, 0.28, 0.04), vLife);
  float a = smoothstep(0.5, 0.0, d) * (1.0 - vLife) * vTwinkle * uIntensity * uOpacity;
  gl_FragColor = vec4(col * a, a * 0.4);
}`,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  return new THREE.Points(result, shader);
}

function flamePoints(THREE, uniforms, quads) {
  // One upright camera-facing flame per point (four quad vertices share a point; keep one).
  const position = [], seed = [], magnitude = [], fresh = [], lngLat = [];
  for (let i = 0; i < quads.position.length / 3; i += 4) {
    position.push(...quads.position.slice(i * 3, i * 3 + 3));
    seed.push(quads.seed[i]); magnitude.push(quads.magnitude[i]); fresh.push(quads.fresh[i]);
    lngLat.push(quads.lngLat[i * 2], quads.lngLat[i * 2 + 1]);
  }
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  result.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  result.setAttribute("aMagnitude", new THREE.Float32BufferAttribute(magnitude, 1));
  result.setAttribute("aFresh", new THREE.Float32BufferAttribute(fresh, 1));
  result.userData.lngLat = lngLat;
  const shader = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: /* glsl */ `
attribute float aSeed, aMagnitude, aFresh;
uniform float uPx, uHeight, uDpr, uSince;
varying float vSeed, vFresh;
void main() {
  float size = uHeight * (0.7 + aMagnitude * 0.7) * mix(0.55, 1.0, aFresh) * (1.0 + 0.8 * aFresh * exp(-uSince));
  vec3 p = position;
  p.z += size * 0.42 * uPx;
  gl_PointSize = size * uDpr;
  vSeed = aSeed; vFresh = aFresh;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`,
    fragmentShader: `${COMMON_UNIFORMS}${NOISE}
varying float vSeed, vFresh;
void main() {
  float y = 1.0 - gl_PointCoord.y;
  float x = gl_PointCoord.x - 0.5;
  float n = fbm(vec2(x * 3.0 + vSeed * 11.0, y * 2.4 - uTime * 2.6));
  float sway = (n - 0.5) * 0.3 * y;
  float width = (1.0 - y) * 0.36 * (0.7 + 0.6 * n);
  float body = smoothstep(width, width * 0.25, abs(x + sway));
  float heat = clamp(body * (1.05 - y * 0.85) * (0.7 + 0.6 * n) * 1.4, 0.0, 1.0) * mix(0.55, 1.0, vFresh);
  vec3 col = fireRamp(heat);
  float a = smoothstep(0.05, 0.4, heat) * uIntensity * uOpacity;
  ${OUTPUT}
}`,
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  return new THREE.Points(result, shader);
}

function waterFill(THREE, uniforms, polygons, frame) {
  const position = [], fresh = [], index = [], lngLat = [];
  for (const polygon of polygons) {
    const [outer, ...holes] = polygon.rings.map((ring) => ring.slice(0, -1));
    if (!outer || outer.length < 3) continue;
    const base = position.length / 3;
    const all = [outer, ...holes].flat();
    all.forEach((coordinate) => { position.push(...frame.toLocal(coordinate)); fresh.push(polygon.fresh); lngLat.push(coordinate[0], coordinate[1]); });
    const toVector = (ring) => ring.map((coordinate) => { const [x, y] = frame.toLocal(coordinate); return new THREE.Vector2(x, y); });
    const triangles = THREE.ShapeUtils.triangulateShape(toVector(outer), holes.map(toVector));
    triangles.forEach(([a, b, c]) => index.push(base + a, base + b, base + c));
  }
  if (!index.length) return null;
  const result = new THREE.BufferGeometry();
  result.setAttribute("position", new THREE.Float32BufferAttribute(position, 3));
  result.setAttribute("aFresh", new THREE.Float32BufferAttribute(fresh, 1));
  result.setIndex(index);
  result.userData.lngLat = lngLat;
  const shader = material(THREE, uniforms, /* glsl */ `
attribute float aFresh;
uniform float uPx;
varying vec2 vPx; varying float vFresh;
void main() { vPx = position.xy / uPx; vFresh = aFresh; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`, "water");
  return new THREE.Mesh(result, shader);
}

/**
 * Terrain heights for every vertex from at most `budget` lookups (each costs
 * ~20 µs): vertices between samples are interpolated along the path, and a
 * sample is always taken on both sides of a jump to another path.
 */
export function sampledHeights(lngLat, heightAt, { budget = 5000, jump = 0.01 } = {}) {
  const count = lngLat.length / 2;
  const heights = new Float64Array(count);
  const step = Math.max(1, Math.ceil(count / budget));
  const coordinate = (i) => [lngLat[i * 2], lngLat[i * 2 + 1]];
  let last = -1;
  for (let i = 0; i < count; i += 1) {
    const breaks = i > 0 && Math.abs(lngLat[i * 2] - lngLat[i * 2 - 2]) + Math.abs(lngLat[i * 2 + 1] - lngLat[i * 2 - 1]) > jump;
    if (breaks && last !== i - 1) { heights[i - 1] = heightAt(coordinate(i - 1)); fill(heights, last, i - 1); last = i - 1; }
    if (i % step === 0 || i === count - 1 || breaks) {
      heights[i] = heightAt(coordinate(i));
      if (!breaks) fill(heights, last, i);
      last = i;
    }
  }
  return heights;
}

function fill(heights, from, to) {
  if (from < 0) return;
  for (let i = from + 1; i < to; i += 1) heights[i] = heights[from] + ((heights[to] - heights[from]) * (i - from)) / (to - from);
}

/**
 * Build a ThreeHost item for one observation snapshot. `items` are
 * [{ feature, fresh }] (or bare features), `effect` a CINEMATIC_EFFECTS key.
 * Returns null when nothing drawable was observed.
 */
export function buildCinematicEffect(THREE, items, { effect = "glow", color, intensity = 1, fields = [], ranges = {}, elevationAt = () => 0, reducedMotion = false } = {}) {
  const parts = effectParts(items);
  const origin = parts.paths[0]?.coordinates[0] || parts.points[0]?.coordinates;
  if (!origin || effect === "none") return null;
  // Geometry is built flat; heights come from the strided terrain sampler below.
  const frame = effectFrame(origin);
  const ground = effectFrame(origin, elevationAt);
  const preset = CINEMATIC_EFFECTS[effect] || CINEMATIC_EFFECTS.glow;
  const tint = color || preset.color;
  const found = effectFields(fields, parts.points[0]?.attributes);
  const builtAt = nowSeconds();
  const uniforms = {
    uTime: { value: 0 }, uSince: { value: 0 }, uPx: { value: 1 }, uDpr: { value: globalThis.devicePixelRatio || 1 },
    uOpacity: { value: 1 }, uIntensity: { value: Math.min(2, Math.max(0.25, Number(intensity) || 1)) },
    uColor: { value: new THREE.Color(tint) }, uAdd: { value: 0.45 }, uWidth: { value: 14 }, uHeight: { value: 44 },
    uRadius: { value: 26 }, uStretch: { value: 0 }, uSpeed: { value: 70 }, uSpacing: { value: 120 }, uGust: { value: 0 }, uRate: { value: 0.32 }, uPalette: { value: 0 },
  };
  const scene = new THREE.Scene();
  const add = (object, order) => { if (!object) return; object.renderOrder = order; object.frustumCulled = false; scene.add(object); };
  const ribbon = parts.paths.length ? ribbonBuffers(parts.paths, frame) : null;
  const quads = parts.points.length ? quadBuffers(parts.points, frame, { magnitudeField: found.magnitude, directionField: found.direction, speedField: found.speed, ranges }) : null;
  const ribbonGeometry = ribbon && geometry(THREE, ribbon, RIBBON_ATTRIBUTES);
  const quadGeometry = quads && geometry(THREE, quads, QUAD_ATTRIBUTES);
  const ribbonMesh = (fragment, overrides) => ribbonGeometry && new THREE.Mesh(ribbonGeometry, material(THREE, uniforms, RIBBON_VERTEX, fragment, overrides));
  const quadMesh = (fragment, overrides) => quadGeometry && new THREE.Mesh(quadGeometry, material(THREE, uniforms, QUAD_VERTEX, fragment, overrides));

  if (effect === "fire") {
    add(ribbonMesh("fireEdge", { uWidth: 9, uAdd: 0.3 }), 1);
    add(ribbonGeometry && new THREE.Mesh(ribbonGeometry, material(THREE, uniforms, WALL_VERTEX, "fireWall", { uAdd: 0.35, uHeight: 36 })), 2);
    const seeds = ribbon && particleSeeds(parts.paths, frame, { count: Math.min(1400, 200 + parts.paths.length * 120) });
    add(seeds && emberPoints(THREE, uniforms, seeds), 3);
    add(quadMesh("spot", { uColor: "#ff5a14", uRadius: 22 }), 1);
    add(quads && flamePoints(THREE, uniforms, quads), 2);
  } else if (effect === "pulse") {
    add(quadMesh("pulse", { uRadius: 26, uAdd: 0.2 }), 1);
    add(ribbonMesh("glow", { uWidth: 14 }), 1);
  } else if (effect === "wind") {
    add(quadMesh("wind", { uRadius: 20, uStretch: 1.1, uAdd: 0.25 }), 1);
    add(ribbonMesh("flow", { uWidth: 9, uSpeed: 150, uSpacing: 90, uGust: 1 }), 1);
  } else if (effect === "water") {
    add(parts.polygons.length && waterFill(THREE, uniforms, parts.polygons, frame), 0);
    add(ribbonMesh("flow", { uWidth: 7, uSpeed: 28, uSpacing: 60, uColor: "#bfefff" }), 1);
    add(quadMesh("pulse", { uRadius: 30, uPalette: 1, uRate: 0.18 }), 1);
  } else if (effect === "flow") {
    add(ribbonMesh("flow", { uWidth: 10, uSpeed: 90, uSpacing: 160, uAdd: 0.3 }), 1);
    add(quadMesh("spot", { uRadius: 16 }), 1);
  } else {
    add(ribbonMesh("glow", { uWidth: 14 }), 1);
    add(quadMesh("spot", { uRadius: 20 }), 1);
  }
  if (!scene.children.length) return null;

  // Terrain heights are sampled per vertex (not once at the origin) so the
  // effect sits on the observed edge across ridges and valleys. Terrain tiles
  // arrive after the first frame, so heights are refreshed while they load and
  // after each completed camera move.
  let sampledKey = "", sampledAt = -Infinity;
  const refreshElevation = (map) => {
    const geometries = new Set();
    scene.traverse((object) => { if (object.geometry?.userData.lngLat) geometries.add(object.geometry); });
    for (const shape of geometries) {
      const heights = sampledHeights(shape.userData.lngLat, (coordinate) => ground.toLocal(coordinate)[2]);
      const positions = shape.getAttribute("position");
      for (let i = 0; i < positions.count; i += 1) positions.setZ(i, heights[i]);
      positions.needsUpdate = true;
    }
    sampledKey = `${Boolean(map?.getTerrain?.())}:${Math.round(map?.getZoom?.() || 0)}`;
  };
  refreshElevation(null);
  return {
    scene,
    origin: frame.mercatorOrigin,
    scale: frame.mercatorScale,
    lngLat: { lng: origin[0], lat: origin[1] },
    onTerrain: false,
    get animated() { return !reducedMotion && !externalClock; },
    effect,
    note: preset.note,
    update(_time, { map } = {}) {
      const now = nowSeconds();
      uniforms.uTime.value = reducedMotion && !externalClock ? 4 : now;
      uniforms.uSince.value = reducedMotion && !externalClock ? 10 : Math.max(0, now - builtAt);
      // Local units per CSS pixel: MapLibre's world is 512 × 2^zoom pixels per Mercator unit.
      if (map?.getZoom) uniforms.uPx.value = 1 / (512 * 2 ** map.getZoom()) / frame.mercatorScale;
      uniforms.uDpr.value = globalThis.devicePixelRatio || 1;
      if (!map) return;
      const key = `${Boolean(map.getTerrain?.())}:${Math.round(map.getZoom?.() || 0)}`;
      const loading = now - builtAt < 8;
      if ((key !== sampledKey || loading) && now - sampledAt > 0.75 && !map.isMoving?.()) {
        sampledAt = now;
        refreshElevation(map);
      }
    },
  };
}
