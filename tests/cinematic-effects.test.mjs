import test from "node:test";
import assert from "node:assert/strict";
import { effectFields, effectFrame, effectParts, particleSeeds, quadBuffers, resolveEffect, ribbonBuffers, suggestEffect } from "../js/cinematic/cinematic-effects.js";
import { normalizeCinematicSpec } from "../js/cinematic/state.js";

test("effect parts keep only valid observed coordinates, tagged fresh, within budget", () => {
  const parts = effectParts([
    { feature: { geometry: { type: "Polygon", coordinates: [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]]] } }, fresh: false },
    { geometry: { type: "LineString", coordinates: [[181, 0], [-120, 40], [-119, 40]] } },
    { feature: { attributes: { mag: 4.2 }, geometry: { type: "Point", coordinates: [-121.9, 37.7] } }, fresh: true },
  ]);
  assert.deepEqual(parts.paths.map((path) => [path.coordinates, path.fresh]), [
    [[[-122, 38], [-121, 38], [-121, 39], [-122, 38]], 0],
    [[[-120, 40], [-119, 40]], 1],
  ]);
  assert.equal(parts.polygons.length, 1);
  assert.deepEqual(parts.points, [{ coordinates: [-121.9, 37.7], fresh: 1, attributes: { mag: 4.2 } }]);
  assert.equal(effectParts([{ geometry: { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] } }], { maxPaths: 1 }).paths.length, 1);
});

test("ribbon vertices sit on the exact observed coordinates and mitre closed rings", () => {
  const frame = effectFrame([-122, 38]);
  const ring = [[-122, 38], [-121.99, 38], [-121.99, 38.01], [-122, 38.01], [-122, 38]];
  const buffers = ribbonBuffers([{ coordinates: ring, fresh: 1 }], frame);
  assert.equal(buffers.position.length / 3, ring.length * 2);
  // Both sides of a vertex share its exact position; width is applied on the GPU.
  assert.deepEqual(buffers.position.slice(0, 3), buffers.position.slice(3, 6));
  assert.deepEqual(buffers.position.slice(0, 3).map((v) => v + 0), [0, 0, 0]);
  // The closing corner mitres across the seam: start and end offsets match, at √2 for a square corner.
  assert.deepEqual(buffers.offset.slice(0, 2).map((v) => v.toFixed(6)), buffers.offset.slice(-4, -2).map((v) => v.toFixed(6)));
  assert.ok(Math.abs(Math.hypot(buffers.offset[0], buffers.offset[1]) - Math.SQRT2) < 1e-6);
  assert.equal(buffers.index.length, (ring.length - 1) * 6);
  assert.ok(buffers.distance.at(-1) > 3000 && buffers.distance.at(-1) < 4500);
});

test("terrain heights are sampled per vertex, not once for the whole effect", () => {
  const frame = effectFrame([-122, 38], (longitude) => (longitude > -121.995 ? 900 : 100));
  const buffers = ribbonBuffers([{ coordinates: [[-122, 38], [-121.99, 38]], fresh: 1 }], frame);
  assert.ok(Math.abs(buffers.position[2] - 100) < 1);
  assert.ok(Math.abs(buffers.position.at(-1) - 900) < 1);
});

test("point quads normalize magnitude and turn wind-from bearings into blow-toward directions", () => {
  const frame = effectFrame([0, 0]);
  const points = [
    { coordinates: [0, 0], fresh: 1, attributes: { mag: 2, wdir: 0, wspd: 5 } },
    { coordinates: [0.1, 0], fresh: 0, attributes: { mag: 6, wdir: 270, wspd: 25 } },
  ];
  const quads = quadBuffers(points, frame, { magnitudeField: "mag", directionField: "wdir", speedField: "wspd" });
  assert.deepEqual([quads.magnitude[0], quads.magnitude[4]], [0, 1]);
  assert.deepEqual([quads.speed[0], quads.speed[4]], [0, 1]);
  // From the north blows south (−y); from the west blows east (+x).
  assert.ok(Math.abs(Math.sin(quads.heading[0]) + 1) < 1e-9);
  assert.ok(Math.abs(Math.cos(quads.heading[4]) - 1) < 1e-9);
  assert.equal(quads.index.length, 12);
  assert.deepEqual(effectFields([{ name: "OBJECTID" }, { name: "mag" }], { wind_speed: 3, WDIR: 10 }), { magnitude: "mag", direction: "WDIR", speed: "wind_speed" });
});

test("embers are deterministic and prefer the newest observed edges", () => {
  const frame = effectFrame([-122, 38]);
  const paths = [{ coordinates: [[-122, 38], [-121.9, 38]], fresh: 0 }, { coordinates: [[-122, 38.1], [-121.9, 38.1]], fresh: 1 }];
  const first = particleSeeds(paths, frame, { count: 50 });
  assert.deepEqual(first, particleSeeds(paths, frame, { count: 50 }));
  assert.ok(first.lngLat.filter((_, index) => index % 2 === 1).every((latitude) => Math.abs(latitude - 38.1) < 1e-9));
});

test("auto effect follows the data and specs migrate the v0.1 glow flag", () => {
  assert.equal(suggestEffect({ title: "Current_Perimeters", geometryType: "polygon" }), "fire");
  assert.equal(suggestEffect({ title: "Earthquakes — past 30 days", geometryType: "point" }), "pulse");
  assert.equal(suggestEffect({ title: "Stations", geometryType: "point", fields: [{ name: "wdir" }, { name: "wspd" }] }), "wind");
  assert.equal(suggestEffect({ title: "Flood stages", geometryType: "polygon" }), "water");
  assert.equal(suggestEffect({ title: "Bus routes", geometryType: "polyline" }), "flow");
  assert.equal(suggestEffect({ title: "Parcels", geometryType: "polygon" }), "glow");
  assert.equal(resolveEffect("auto", { title: "USGS quakes", geometryType: "point" }), "pulse");
  assert.equal(resolveEffect("sparkles"), "glow");
  const layer = (animation) => normalizeCinematicSpec({ layers: [{ layerRef: "a", temporal: { startField: "t" }, animation }] }).cinematic.layers[0].animation.effect;
  assert.deepEqual(layer({ outline: { glow: true } }), { type: "glow", color: null, intensity: 1 });
  assert.deepEqual(layer({ effect: { type: "fire", color: "#ff0000", intensity: 9 } }), { type: "fire", color: "#ff0000", intensity: 2 });
  assert.equal(layer({ effect: { type: "lasers" } }).type, "none");
});

test("terrain sampling stays within budget, interpolates along a path and resamples at path jumps", async () => {
  const { sampledHeights } = await import("../js/cinematic/effects-three.js");
  const lngLat = [];
  for (let i = 0; i <= 100; i += 1) lngLat.push(-122 + i * 0.0001, 38);
  lngLat.push(-121, 39, -120.9999, 39);
  const calls = [];
  const heights = sampledHeights(lngLat, ([longitude, latitude]) => { calls.push(longitude); return latitude === 39 ? 5000 : (longitude + 122) * 1e4; }, { budget: 10 });
  assert.ok(calls.length <= 16);
  assert.ok(Math.abs(heights[37] - 37) < 1e-6);
  assert.deepEqual([...heights.slice(-2)], [5000, 5000]);
});

test("layer effects travel in map specs and share links, and bad ones are reported", async () => {
  const { normalizeLayerEffect } = await import("../js/cinematic/cinematic-effects.js");
  const { validateMapSpec } = await import("../js/map-spec.js");
  const { packLayer } = await import("../js/map-share.js");
  assert.deepEqual(normalizeLayerEffect({ type: "fire", intensity: 0.1 }), { type: "fire", intensity: 0.25, color: null });
  assert.equal(normalizeLayerEffect({ type: "none" }), null);
  assert.equal(normalizeLayerEffect("glow"), null);
  const ok = validateMapSpec({ version: 1, layers: [{ url: "https://example.org/quakes.geojson", animatedEffect: { type: "pulse", intensity: 1.5 } }] });
  assert.deepEqual(ok.spec.layers[0].animatedEffect, { type: "pulse", intensity: 1.5, color: null });
  const bad = validateMapSpec({ version: 1, layers: [{ url: "https://example.org/quakes.geojson", animatedEffect: { type: "lasers" } }] });
  assert.equal(bad.spec.layers[0].animatedEffect, undefined);
  assert.ok(bad.issues.some((issue) => issue.path === "layers[0].animatedEffect"));
  // Links prune empty values; reading one back normalizes the effect again.
  assert.deepEqual(packLayer({ url: "https://example.org/quakes.geojson", sourceType: "geojson", animatedEffect: { type: "glow", intensity: 1 } }).e, { type: "glow", intensity: 1 });
  assert.deepEqual(normalizeLayerEffect({ type: "glow", intensity: 1 }), { type: "glow", intensity: 1, color: null });
});
