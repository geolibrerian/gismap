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

test("random points follow each polygon's value, stay inside it and repeat with the same seed", async () => {
  const { randomPointsByValue, niceUnits, MAX_RANDOM_POINTS } = await import("../js/random-points.js");
  const tract = (x, people, extra = {}) => ({ ...square(x, 40, 0.5), properties: { pop: people, ...extra } });
  const islands = { type: "Feature", properties: { pop: 300 }, geometry: { type: "MultiPolygon", coordinates: [square(5, 40, 0.2).geometry.coordinates, square(6, 40, 0.2).geometry.coordinates] } };
  const polygons = collection([tract(0, 1000), tract(1, "250"), tract(2, null), tract(3, 0), islands]);
  const result = randomPointsByValue({ turf, polygons, field: "pop", unitsPerPoint: 10, seed: 3 });
  const counts = [0, 0, 0, 0, 0];
  for (const point of result.collection.features) {
    counts[point.properties.polygon_index] += 1;
    assert.equal(point.properties.represents, 10);
    assert.ok(turf.booleanPointInPolygon(point, polygons.features[point.properties.polygon_index]));
  }
  assert.deepEqual(counts, [100, 25, 0, 0, 30], "a multipolygon's value is shared by its parts, not given to each");
  assert.deepEqual(result.metadata.skipped, { missingValue: 1, notPositive: 1, unplaced: 0 });
  const again = randomPointsByValue({ turf, polygons, field: "pop", unitsPerPoint: 10, seed: 3 });
  assert.deepEqual(again.collection.features.map((f) => f.geometry.coordinates), result.collection.features.map((f) => f.geometry.coordinates));
  const other = randomPointsByValue({ turf, polygons, field: "pop", unitsPerPoint: 10, seed: 4 });
  assert.notDeepEqual(other.collection.features[0].geometry.coordinates, result.collection.features[0].geometry.coordinates);

  // Fractions round up with their probability, so the expected total holds over many polygons.
  const many = collection(Array.from({ length: 400 }, (_, index) => ({ ...square(index % 20, 10 + Math.floor(index / 20), 0.5), properties: { pop: 25 } })));
  const fractional = randomPointsByValue({ turf, polygons: many, field: "pop", unitsPerPoint: 10 });
  assert.ok(Math.abs(fractional.collection.features.length - 1000) < 60, `${fractional.collection.features.length} points for an expected 1,000`);

  const auto = randomPointsByValue({ turf, polygons: collection([tract(0, 3_000_000)]), field: "pop" });
  assert.equal(auto.metadata.unitsPerPoint, 500);
  assert.equal(auto.collection.features.length, 6000);
  assert.deepEqual([niceUnits(0.4), niceUnits(1.3), niceUnits(300), niceUnits(3001)], [1, 2, 500, 5000]);
  assert.throws(() => randomPointsByValue({ turf, polygons, field: "pop", unitsPerPoint: 0.01 }), new RegExp(`over the ${MAX_RANDOM_POINTS.toLocaleString("en-US")} limit. Use at least`));
  assert.throws(() => randomPointsByValue({ turf, polygons, field: "" }), /need a numeric field/);
  assert.throws(() => randomPointsByValue({ turf, polygons, field: "income" }), /No polygon has the field "income"/);
});

test("random points spread evenly by area across a tall polygon", async () => {
  const { randomPointsByValue } = await import("../js/random-points.js");
  const tall = collection([{ type: "Feature", properties: { pop: 20000 }, geometry: { type: "Polygon", coordinates: [[[0, 0], [10, 0], [10, 70], [0, 70], [0, 0]]] } }]);
  const { features } = randomPointsByValue({ turf, polygons: tall, field: "pop", unitsPerPoint: 1, seed: 9 }).collection;
  const area = (south, north) => turf.area(turf.bboxPolygon([0, south, 10, north]));
  const share = features.filter((f) => f.geometry.coordinates[1] > 50).length / features.length;
  const expected = area(50, 70) / area(0, 70);
  assert.ok(Math.abs(share - expected) < 0.02, `${share.toFixed(3)} of points north of 50°, expected ${expected.toFixed(3)}`);
});

test("random points run as an analysis operation and polygon cards offer them", () => {
  const input = collection([{ ...square(0, 0, 1), properties: { pop: 50 } }]);
  const result = runSpatialOperation(turf, "random-points", { input, options: { field: "pop", unitsPerPoint: "5", seed: "2" } });
  assert.equal(result.collection.features.length, 10);
  assert.equal(result.randomPoints.unitsPerPoint, 5);
  const blank = runSpatialOperation(turf, "random-points", { input, options: { field: "pop", unitsPerPoint: "" } });
  assert.equal(blank.randomPoints.unitsPerPoint, 1);
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /\/polygon\/i\.test\(layer\.geometryType \|\| ""\) && numericLayerFields\(layer\)\.length \? '<button data-layer-action="random-points"[^>]*>Random points<\/button>'/);
  assert.match(ui, /operation: "random-points", input: uid, options: \{ field: field\?\.name \|\| "" \}/);
});

/** A map controller over in-memory features, answering pages like a service whose pages hold `serverPage` at most. */
function fakeController(features, { serverPage = 1000, truncatedLayer = false, view = { xmin: 0, ymin: 0, xmax: 1, ymax: 1, spatialReference: { wkid: 4326 } } } = {}) {
  const calls = [];
  const inBox = (feature, box) => { const [x, y] = feature.geometry.coordinates[0][0]; return x >= box.xmin && x <= box.xmax && y >= box.ymin && y <= box.ymax; };
  const select = (params) => (params.geometry ? features.filter((feature) => inBox(feature, params.geometry)) : features);
  return {
    calls,
    getLayer: () => ({ queryable: true, title: "Blocks", where: null, objectIdField: "OBJECTID", truncated: truncatedLayer }),
    getViewExtent: () => view,
    async queryFeatures(uid, params) {
      calls.push(params);
      const all = select(params);
      const page = all.slice(params.start, params.start + Math.min(params.num, serverPage));
      return { features: page.map((feature) => ({ attributes: feature.properties, geometry: { rings: feature.geometry.coordinates } })), exceededTransferLimit: params.start + page.length < all.length };
    },
    async queryFeatureCount(uid, params) { return select(params).length; },
  };
}
const blocks = (count, x = 0) => Array.from({ length: count }, (_, index) => ({ ...square(x + (index % 100) * 0.005, (Math.floor(index / 100) % 100) * 0.005, 0.004), properties: { OBJECTID: index + 1, pop: 20 } }));

test("analysis can read only the features in the map view", async () => {
  const { readLayerFeatures } = await import("../js/spatial-analysis.js");
  const controller = fakeController([...blocks(300, 0), ...blocks(200, 5)]);
  const view = await readLayerFeatures(controller, "blocks", 1000, { area: "view" });
  assert.equal(view.collection.features.length, 300);
  assert.equal(view.truncated, false);
  assert.ok(controller.calls.every((params) => params.geometry?.xmax === 1), "every page asks for the same view");
  const whole = await readLayerFeatures(controller, "blocks", 1000);
  assert.equal(whole.collection.features.length, 500);
});

test("analysis keeps reading when a service sends short pages, and counts what it left out", async () => {
  const { readLayerFeatures } = await import("../js/spatial-analysis.js");
  const short = await readLayerFeatures(fakeController(blocks(2500), { serverPage: 400 }), "blocks", 5000);
  assert.deepEqual([short.collection.features.length, short.truncated], [2500, false]);
  const capped = await readLayerFeatures(fakeController(blocks(2500)), "blocks", 1200);
  assert.deepEqual([capped.collection.features.length, capped.truncated, capped.total], [1200, true, { count: 2500, atLeast: false }]);
  // On MapLibre a big service layer is held only in part, so its whole is never complete.
  const part = await readLayerFeatures(fakeController(blocks(800), { truncatedLayer: true }), "blocks", 5000);
  assert.deepEqual([part.truncated, part.total], [true, { count: 800, atLeast: true }]);
  const partView = await readLayerFeatures(fakeController(blocks(800), { truncatedLayer: true }), "blocks", 5000, { area: "view" });
  assert.equal(partView.truncated, false);
});

test("an incomplete result says so first, with how much it used and how to cover the rest", async () => {
  const { createSpatialAnalysisApi, MAX_RANDOM_POINT_POLYGONS, SPATIAL_OPERATIONS } = await import("../js/spatial-analysis.js");
  globalThis.turf = turf;
  const analysis = createSpatialAnalysisApi({ mapController: fakeController(blocks(2500)), layers: { get: () => ({ id: "blocks", title: "Blocks", where: null }) } });
  const limited = { ...SPATIAL_OPERATIONS.find((item) => item.id === "random-points") };
  assert.equal(limited.maxInput, MAX_RANDOM_POINT_POLYGONS);
  assert.ok(limited.options.some((option) => option.name === "area"));
  const whole = await analysis.run("random-points", { input: "blocks", options: { field: "pop", unitsPerPoint: 10 }, addToMap: false });
  assert.equal(whole.truncated, false);
  assert.doesNotMatch(whole.summary, /Incomplete/);
  const big = createSpatialAnalysisApi({ mapController: fakeController(blocks(2500), { truncatedLayer: true }), layers: { get: () => ({ id: "blocks", title: "Blocks", where: null }) } });
  const partial = await big.run("random-points", { input: "blocks", options: { field: "pop" }, addToMap: false });
  assert.match(partial.summary, /^Incomplete: used the first 2,500 of more than 2,500 features \(the limit is 50,000\)\. Zoom in and choose In the current map view/);
  const viewed = await big.run("random-points", { input: "blocks", options: { field: "pop", area: "view" }, addToMap: false });
  assert.equal(viewed.truncated, false);
  delete globalThis.turf;
});

test("map links chain analysis steps and can hide a step's layer", () => {
  const layers = [{ url: "https://example.com/arcgis/rest/services/Blocks/FeatureServer/0" }];
  const { spec, issues } = validateMapSpec({ version: 1, layers, analysis: [
    { operation: "nope", input: 0 },
    { operation: "random-points", input: 0, options: { field: "pop" }, visible: false },
    { operation: "hexbin", input: { step: 1 }, options: { statistic: "sum", field: "represents" } },
    { operation: "hexbin", input: { step: 0 } },
    { operation: "hexbin", input: { step: 4 } },
  ] });
  // The unknown first step is dropped, so step 1 becomes step 0; steps that point at dropped or later steps are refused.
  assert.deepEqual(spec.analysis.map(({ operation, input, visible }) => [operation, input, visible]), [["random-points", 0, false], ["hexbin", { step: 0 }, undefined]]);
  assert.equal(issues.filter((issue) => issue.path.startsWith("analysis")).length, 3);
});

test("the Discover hexagon example validates and chains its steps", () => {
  const page = readFileSync(new URL("../discover/examples/index.html", import.meta.url), "utf8");
  const link = page.match(/href="\.\.\/\.\.\/#map=json:([^"]+)">Open 3D hexagon map/)?.[1];
  assert.ok(link, "the card links to a map");
  const { spec, issues } = validateMapSpec(JSON.parse(decodeURIComponent(link)));
  assert.deepEqual(issues, []);
  assert.equal(spec.layers[0].where, "County_Name = 'Ventura County' AND P0010001 > 0");
  assert.deepEqual(spec.analysis.map((step) => [step.operation, step.input]), [["random-points", 0], ["hexbin", { step: 0 }]]);
});

test("the hexagon example has a tutorial, and tutorial cards can be closed", async () => {
  const { MAP_TUTORIALS } = await import("../js/workspace-walkthrough.js");
  const tutorial = MAP_TUTORIALS["hex-population"];
  assert.equal(tutorial.steps.length, 7);
  assert.ok(tutorial.steps.every((step) => step.title && step.desktop && step.mobile && step.description));
  assert.equal(tutorial.steps.find((step) => step.id === "legend")?.desktop, "#utility-legend-content");
  const page = readFileSync(new URL("../discover/examples/index.html", import.meta.url), "utf8");
  assert.match(page, /href="\.\.\/\.\.\/\?tutorial=hex-population#map=json:[^"]+">Open with a tutorial/);
  const app = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  assert.match(app, /Object\.hasOwn\(MAP_TUTORIALS, tutorialId \|\| ""\)/);
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /data-example-guide-close aria-label="Close the tutorial card"/);
  assert.match(ui, /\[data-example-guide-close\]"\)\?\.addEventListener\("click", \(\) => \{\s*this\.activeExampleGuide = null;/);
});
