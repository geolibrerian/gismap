import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { niceBreak, terraceBreaks, terracedSurface } from "../js/terraced-surface.js";

const sandbox = {};
sandbox.globalThis = sandbox; sandbox.self = sandbox;
vm.runInNewContext(readFileSync(new URL("../js/vendor/turf-7.4.0.min.js", import.meta.url), "utf8"), sandbox);
const { turf } = sandbox;

const square = (x, y, size, properties) => ({ type: "Feature", properties, geometry: { type: "Polygon", coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] } });
// A 12 × 12 grid of 0.25° squares whose value rises from west (0) to east (11).
const ramp = Array.from({ length: 144 }, (_, at) => square(at % 12 * 0.25, Math.floor(at / 12) * 0.25, 0.25, { v: at % 12, people: 100 }));
const area = (feature) => turf.area(feature);

test("breaks are ascending equal-area quantiles, rounded for reading", () => {
  const values = Array.from({ length: 1000 }, (_, at) => 30 + at * 0.0123);
  const breaks = terraceBreaks(values, 4);
  assert.equal(breaks.length, 4);
  assert.deepEqual([...breaks].sort((a, b) => a - b), breaks);
  assert.equal(breaks[0], 30);
  assert.ok(breaks.every((value) => Number(value.toFixed(1)) === value), `rounded: ${breaks}`);
  assert.deepEqual(terraceBreaks([5, 5, 5, 5], 3), [5], "equal values give one terrace, not repeated ones");
  assert.equal(niceBreak(38.4721, 1.2), 38.5);
  assert.equal(niceBreak(1234.5, 300), 1235);
});

test("terraces nest: each sits inside the one below and covers less ground", () => {
  const { collection, breaks } = terracedSurface(turf, ramp, { field: "v", classes: 4, bandwidthKm: 20 });
  assert.equal(collection.features.length, breaks.length);
  assert.deepEqual(collection.features.map((feature) => feature.properties.band), breaks.map((_, band) => band));
  assert.deepEqual(collection.features.map((feature) => feature.properties.value), breaks);
  const areas = collection.features.map(area);
  for (let band = 1; band < areas.length; band += 1) assert.ok(areas[band] < areas[band - 1], `terrace ${band} is smaller than the one below`);
  // The lowest terrace covers the layer itself, give or take the smoothed edge.
  const layer = 12 * 0.25 * 12 * 0.25;
  const [west, south, east, north] = turf.bbox(collection.features[0]);
  assert.ok(Math.abs((east - west) * (north - south) - layer) / layer < 0.15, "the lowest terrace has the layer's extent");
  // The highest terrace is in the east, where values are highest.
  const [x] = turf.centroid(collection.features.at(-1)).geometry.coordinates;
  assert.ok(x > 1.5, `top terrace centroid ${x}`);
});

test("a weight field pulls the surface toward heavy polygons, and explicit breaks are kept", () => {
  const weighted = ramp.map((feature) => (feature.properties.v === 0 ? { ...feature, properties: { ...feature.properties, people: 1e6 } } : feature));
  const plain = terracedSurface(turf, ramp, { field: "v", breaks: [0, 4], bandwidthKm: 60 });
  const heavy = terracedSurface(turf, weighted, { field: "v", weightField: "people", breaks: [0, 4], bandwidthKm: 60 });
  assert.deepEqual(heavy.breaks, [0, 4]);
  assert.ok(area(heavy.collection.features[1]) < area(plain.collection.features[1]), "heavy low-value polygons shrink the high terrace");
});

test("polygons without a value or weight are skipped, and too few is an error", () => {
  const sparse = [square(0, 0, 1, { v: 1, people: 0 }), square(1, 0, 1, { v: null, people: 5 }), square(2, 0, 1, { v: "", people: 5 }), square(3, 0, 1, { v: 2, people: 5 })];
  assert.throws(() => terracedSurface(turf, sparse, { field: "v", weightField: "people" }), /at least three polygons/);
});

test("a large extent coarsens the grid instead of growing past the cell limit", () => {
  const wide = Array.from({ length: 20 }, (_, at) => square(-170 + at * 17, -60, 17, { v: at }));
  const result = terracedSurface(turf, wide, { field: "v", cellKm: 1 });
  assert.ok(result.cellKm > 1);
  assert.ok(result.collection.features.length > 1);
});
