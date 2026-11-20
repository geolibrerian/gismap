import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { binPoints, MAX_BIN_CELLS, statisticField } from "../js/hex-binning.js";
import { hexbinMethod, runSpatialOperation } from "../js/spatial-analysis.js";
import { validateMapSpec } from "../js/map-spec.js";

const sandbox = {};
sandbox.globalThis = sandbox; sandbox.self = sandbox;
for (const file of ["turf-7.4.0.min.js", "h3-js-4.5.0.umd.js"]) vm.runInNewContext(readFileSync(new URL(`../js/vendor/${file}`, import.meta.url), "utf8"), sandbox);
const { turf, h3 } = sandbox;

const point = (x, y, properties = {}) => ({ type: "Feature", properties, geometry: { type: "Point", coordinates: [x, y] } });
const collection = (features) => ({ type: "FeatureCollection", features });
const square = (x, y, size) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] } });
// A seeded generator, so the point clouds are the same every run.
const random = (seed) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const cloud = (count, [west, south, east, north], seed = 7) => {
  const next = random(seed);
  return Array.from({ length: count }, (_, index) => point(west + next() * (east - west), south + next() * (north - south), { value: index % 5 === 0 ? null : index % 100, label: `p${index}` }));
};
const bin = (features, options = {}) => binPoints({ turf, h3, points: collection(features), ...options });
const byId = (result) => Object.fromEntries(result.collection.features.map((feature) => [feature.properties.h3_id ?? feature.properties.cell_id, feature.properties]));

test("H3 bins count every point once, in the cell latLngToCell gives", () => {
  const features = cloud(2000, [-122.5, 37.6, -122.2, 37.9]);
  const result = bin(features, { resolution: 8 });
  const total = result.collection.features.reduce((sum, feature) => sum + feature.properties.point_count, 0);
  assert.equal(total, 2000);
  const expected = new Map();
  for (const { geometry: { coordinates: [x, y] } } of features) { const id = h3.latLngToCell(y, x, 8); expected.set(id, (expected.get(id) || 0) + 1); }
  for (const feature of result.collection.features) {
    assert.equal(feature.properties.point_count, expected.get(feature.properties.h3_id));
    assert.equal(feature.properties.h3_resolution, 8);
    assert.equal(typeof feature.properties.h3_id, "string");
  }
});

test("bins do not depend on the order of the points", () => {
  const features = cloud(3000, [10, 45, 11, 46]);
  const shuffled = [...features].reverse();
  for (const options of [{ method: "h3", resolution: 7, field: "value" }, { method: "turf", cellKm: 5, field: "value" }]) {
    const a = bin(features, options); const b = bin(shuffled, options);
    assert.deepEqual(Object.keys(byId(a)), Object.keys(byId(b)));
    for (const [id, properties] of Object.entries(byId(a))) {
      assert.equal(byId(b)[id].point_count, properties.point_count);
      assert.ok(Math.abs(byId(b)[id].value_mean - properties.value_mean) < 1e-9);
    }
  }
});

test("field statistics skip blanks and text, and empty cells get null, not zero", () => {
  const id = h3.latLngToCell(0.001, 0.001, 9);
  const [lat, lng] = h3.cellToLatLng(id);
  const features = [point(lng, lat, { price: 10 }), point(lng, lat, { price: "30" }), point(lng, lat, { price: "" }), point(lng, lat, { price: "n/a" }), point(lng, lat, {})];
  const area = collection([turf.buffer(point(lng, lat), 0.5, { units: "kilometers" })]);
  const result = bin(features, { resolution: 9, statistic: "mean", field: "price", keepEmpty: true, area });
  const cells = byId(result);
  assert.deepEqual({ ...cells[id], cell_area_km2: undefined, density_km2: undefined }, { h3_id: id, h3_resolution: 9, point_count: 5, value_count: 2, price_sum: 40, price_mean: 20, price_min: 10, price_max: 30, cell_area_km2: undefined, density_km2: undefined });
  assert.equal(result.metadata.skipped.missingValue, 3);
  const empty = Object.values(cells).filter((cell) => cell.point_count === 0);
  assert.ok(empty.length > 0, "the study area adds empty cells");
  for (const cell of empty) assert.deepEqual([cell.value_count, cell.price_sum, cell.price_mean, cell.price_min, cell.price_max, cell.density_km2], [0, null, null, null, null, 0]);
  assert.equal(result.styleField, "price_mean");
  assert.match(result.summary, /3 points had no number in price/);
});

test("density divides by each cell's own area", () => {
  const result = bin(cloud(500, [-1, 50, 1, 52]), { resolution: 6, statistic: "density" });
  for (const { properties } of result.collection.features) {
    const area = h3.cellArea(properties.h3_id, "km2");
    assert.ok(Math.abs(properties.cell_area_km2 - area) / area < 1e-6);
    assert.ok(Math.abs(properties.density_km2 - properties.point_count / area) / properties.density_km2 < 1e-6);
  }
  assert.equal(result.styleField, "density_km2");
});

test("invalid coordinates and points outside the study area are skipped and reported", () => {
  const features = [point(0.5, 0.5), point(Number.NaN, 0), point(200, 0), point(0, 95), point(3, 3)];
  const result = bin(features, { resolution: 5, area: collection([square(0, 0, 1)]) });
  assert.deepEqual(result.metadata.skipped, { invalidCoordinates: 3, outsideArea: 1, outsideGrid: 0, missingValue: 0 });
  assert.equal(result.metadata.binned, 1);
  assert.match(result.summary, /3 points had invalid coordinates; 1 point fell outside the study area/);
});

test("H3 cells keep their whole canonical boundary, even at pentagons, the poles and the 180° meridian", () => {
  const pentagon = h3.getPentagons(4)[0];
  const [lat, lng] = h3.cellToLatLng(pentagon);
  const result = bin([point(lng, lat), point(179.99, 10), point(-179.99, 10), point(10, 89.9)], { resolution: 4 });
  const cells = result.collection.features;
  const five = cells.find((feature) => feature.properties.h3_id === pentagon);
  assert.equal(five.geometry.coordinates[0].length - 1, h3.cellToBoundary(pentagon).length);
  for (const feature of cells) {
    const ring = feature.geometry.coordinates[0];
    for (let index = 1; index < ring.length; index += 1) assert.ok(Math.abs(ring[index][0] - ring[index - 1][0]) < 180, `${feature.properties.h3_id} does not jump across the map`);
    assert.ok(feature.properties.cell_area_km2 > 0);
  }
});

test("a Turf grid summarises points with a lookup and keeps whole hexagons in a study area", () => {
  const features = cloud(5000, [0, 0, 2, 2]);
  const result = bin(features, { method: "turf", cellKm: 10, statistic: "max", field: "value" });
  const total = result.collection.features.reduce((sum, feature) => sum + feature.properties.point_count, 0);
  assert.equal(total, 5000);
  for (const feature of result.collection.features.slice(0, 20)) {
    const inside = features.filter((item) => turf.booleanPointInPolygon(item, feature)).length;
    assert.equal(feature.properties.point_count, inside);
    assert.match(feature.properties.cell_id, /^hex-\d+$/);
    assert.equal(feature.properties.cell_side_km, 10);
  }
  const area = collection([square(0.5, 0.5, 0.5)]);
  const clipped = bin(features, { method: "turf", cellKm: 10, area, keepEmpty: true });
  const full = turf.area(result.collection.features[0]) / 1e6;
  for (const feature of clipped.collection.features) {
    assert.ok(turf.booleanIntersects(feature, area.features[0]));
    assert.ok(Math.abs(feature.properties.cell_area_km2 - full) / full < 0.05, "cells are not clipped");
  }
});

test("too many cells is refused with a way out", () => {
  assert.throws(() => bin(cloud(10, [-100, 20, -60, 50]), { resolution: 9, keepEmpty: true }), new RegExp(`over the ${MAX_BIN_CELLS.toLocaleString("en-US")} limit.*lower resolution`));
  assert.throws(() => bin(cloud(10, [-100, 20, -60, 50]), { method: "turf", cellKm: 0.5 }), /larger hexagon/);
});

test("statistics that need a field say so", () => {
  assert.throws(() => bin(cloud(10, [0, 0, 1, 1]), { statistic: "sum" }), /needs a numeric field/);
  assert.throws(() => bin(cloud(10, [0, 0, 1, 1]), { statistic: "sum", field: "missing" }), /No point has the field "missing"/);
  assert.equal(statisticField("count"), "point_count");
  assert.equal(statisticField("max", "PRICE"), "PRICE_max");
});

test("the hexbin operation defaults to H3 and keeps old cellKm links on the Turf grid", () => {
  const input = collection(cloud(200, [0, 0, 1, 1]));
  assert.equal(hexbinMethod({}), "h3");
  assert.equal(hexbinMethod({ cellKm: 20 }), "turf");
  const modern = runSpatialOperation(turf, "hexbin", { input, h3, options: { resolution: "6", keepEmpty: "false" } });
  assert.equal(modern.binning.method, "h3");
  assert.ok(modern.collection.features.every((feature) => feature.properties.h3_resolution === 6));
  const legacy = runSpatialOperation(turf, "hexbin", { input, options: { cellKm: 20 } });
  assert.equal(legacy.binning.method, "turf");
  assert.throws(() => runSpatialOperation(turf, "hexbin", { input, h3, options: { resolution: 6.5 } }), /whole number/);
  assert.throws(() => runSpatialOperation(turf, "hexbin", { input, h3, options: { statistic: "median" } }), /Statistic must be one of/);
});

test("map links accept hexbin steps with or without a study area", () => {
  const layers = [{ url: "https://example.com/arcgis/rest/services/Points/FeatureServer/0" }];
  const { spec, issues } = validateMapSpec({ version: 1, layers, analysis: [{ operation: "hexbin", input: 0, options: { resolution: 8, statistic: "count" } }] });
  assert.equal(spec.analysis.length, 1);
  assert.equal(issues.filter((issue) => issue.path.startsWith("analysis")).length, 0);
  const bad = validateMapSpec({ version: 1, layers, analysis: [{ operation: "clip", input: 0 }] });
  assert.equal(bad.spec.analysis, undefined);
});

test("point layer cards open Hexagon binning with the layer chosen", () => {
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../js/spatial-analysis-panel.js", import.meta.url), "utf8");
  assert.match(ui, /layer\.queryable && \/point\/i\.test\(layer\.geometryType \|\| ""\) \? '<button data-layer-action="hexbin"[^>]*>Hexagon map<\/button>'/);
  assert.match(ui, /case "hexbin": \{[\s\S]*?openSpatialAnalysis\(this, globalThis\.gisMapOnline\.analysis, \{ operation: "hexbin", input: uid \}\)/);
  assert.match(panel, /export function openSpatialAnalysis\(ui, analysis, preset = \{\}\)/);
});
