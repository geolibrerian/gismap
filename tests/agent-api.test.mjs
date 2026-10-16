import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { GISMAP_CORE_VERSION, capabilities as coreCapabilities } from "../js/gismap-core.js";
import { ERROR_CODES, GisMapError, layerLoadError, toGisMapError } from "../js/gismap-errors.js";
import { detectSentinels, inspectSource } from "../js/source-inspector.js";
import { RAMPS, RENDERER_TYPES, compileRenderer, computeBreaks, validateRendererSpec } from "../js/renderer-spec.js";
import { computeStat } from "../js/briefing-document.js";
import { LAYER_TOOL_DEFINITIONS, checkToolInput } from "../js/layer-tools.js";
import { checkWhere, createLayersApi } from "../js/layers-api.js";
import { parseShareParameters } from "../js/share.js";
import { createClientApi } from "../js/briefing-api.js";
import { MapController } from "../js/map.js";

const read = async (path) => readFile(new URL(path, import.meta.url), "utf8");
const json = async (path) => JSON.parse(await read(path));
const CORN = "https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/Corn/FeatureServer/0";

test("the API version is the same in VERSION, capabilities.json and gismap-core", async () => {
  const published = await json("../api/capabilities.json");
  const version = (await read("../VERSION")).trim();
  assert.equal(published.apiVersion, GISMAP_CORE_VERSION);
  assert.equal(version, GISMAP_CORE_VERSION);
  assert.equal(coreCapabilities.apiVersion, GISMAP_CORE_VERSION);
});

test("capabilities.json lists the live tools, error codes, styles and the whole in-page surface", async () => {
  const published = await json("../api/capabilities.json");
  assert.deepEqual(published.tools, JSON.parse(JSON.stringify(LAYER_TOOL_DEFINITIONS)), "tools and their input schemas match layer-tools.js");
  assert.deepEqual(Object.keys(published.errorCodes), Object.keys(ERROR_CODES));
  assert.deepEqual(published.ramps, Object.keys(RAMPS));
  assert.deepEqual(published.rendererTypes, [...RENDERER_TYPES]);
  for (const member of ["ready", "describe", "layers", "camera", "briefing", "application", "map", "view", "events", "getProject", "exportData", "getConnections"]) {
    assert.ok(published.inPage[member]?.stability, `${member} has a stability level`);
  }
  assert.equal(published.inPage.map.stability, "experimental");
  const types = await read("../js/gismap-core.d.ts");
  for (const name of ["InPageApi", "LayersApi", "CameraApi", "LayerInfo", "RendererSpec", "GisMapError", "Sentinel"]) assert.match(types, new RegExp(`\\b${name}\\b`));
  const schema = await json("../schemas/renderer-v1.schema.json");
  assert.deepEqual(schema.oneOf.map((variant) => variant.properties.type.const), [...RENDERER_TYPES]);
});

test("sources.inspect reports the Corn layer's Not Disclosed sentinel, scale limit, freshness and count", async () => {
  const layer = await json("./fixtures/corn-layer.json");
  const { values } = await json("./fixtures/corn-sales-values.json");
  const sample = values.slice(0, 200).map((value) => ({ attributes: { CORN_SALES_IN_DOLLARS: value } }));
  const fetchImpl = async (href) => {
    const url = new URL(href);
    const body = url.searchParams.get("returnCountOnly") ? { count: 3074 } : url.pathname.endsWith("/query") ? { features: sample } : layer;
    return { ok: true, json: async () => body };
  };
  const metadata = await inspectSource(CORN, { fetchImpl });
  assert.deepEqual(metadata.sentinels.filter((item) => item.source === "renderer"), [{ field: "CORN_SALES_IN_DOLLARS", value: -1, label: "Not Disclosed", source: "renderer" }]);
  assert.equal(metadata.maxScale, 144447);
  assert.match(metadata.dataLastEditDate, /^2022-08/);
  assert.equal(metadata.featureCount, 3074);
  assert.equal(metadata.supportsStatistics, true);
  assert.ok(metadata.extent[0] < -170 && metadata.extent[2] < -60, "the extent is WGS84 degrees");
  // A plain -9999 used by more than 1% of a sample is reported, but only as a heuristic.
  const heuristic = detectSentinels({ fields: [{ name: "DEPTH", type: "esriFieldTypeDouble" }] }, Array.from({ length: 50 }, (_, index) => ({ attributes: { DEPTH: index < 3 ? -9999 : index } })));
  assert.deepEqual(heuristic, [{ field: "DEPTH", value: -9999, label: "Possible no-data code", source: "heuristic" }]);
});

test("RendererSpecs validate against the fields, with a did-you-mean, and sentinels stay out of the classes", async () => {
  const layer = await json("./fixtures/corn-layer.json");
  const { values } = await json("./fixtures/corn-sales-values.json");
  const fields = layer.fields;
  const bad = validateRendererSpec({ type: "choropleth", field: "CORN_SALES" }, { fields });
  assert.equal(bad.valid, false);
  assert.equal(bad.issues[0].code, "FIELD_NOT_FOUND");
  assert.match(bad.issues[0].message, /did you mean `CORN_SALES_IN_DOLLARS`/);
  assert.equal(validateRendererSpec({ type: "choropleth", field: "county_name" }, { fields }).issues[0].code, "INVALID_SPEC", "text fields cannot be classed");
  assert.equal(validateRendererSpec({ type: "choropleth", field: "CORN_SALES_IN_DOLLARS", ramp: "rainbow" }, { fields }).valid, false);
  const { spec } = validateRendererSpec({ type: "choropleth", field: "corn_sales_in_dollars", exclude: [-1] }, { fields });
  assert.equal(spec.field, "CORN_SALES_IN_DOLLARS", "field names are matched case-insensitively and corrected");
  const renderer = compileRenderer(spec, { geometryType: "polygon", values });
  assert.equal(renderer.type, "class-breaks");
  assert.equal(renderer.classBreakInfos.length, 5);
  assert.ok(renderer.classBreakInfos[0].minValue >= 0, "-1 is not part of the classes");
  assert.equal(renderer.classBreakInfos.at(-1).maxValue, Math.max(...values));
  assert.match(renderer.valueExpression, /Includes\(\[-1\], v\)/);
  assert.equal(renderer.defaultLabel, "No data");
  assert.equal(values.filter((value) => value === -1).length, 546, "the No data class holds the 546 undisclosed counties");
});

test("class breaks: natural breaks, quantiles and equal intervals", () => {
  const values = [1, 2, 3, 4, 5, 50, 51, 52, 53, 100, 101, 102];
  const natural = computeBreaks(values, { classes: 3 });
  assert.deepEqual(natural.breaks, [5, 53, 102]);
  assert.equal(natural.min, 1);
  assert.deepEqual(computeBreaks(values, { classes: 4, method: "equal-interval" }).breaks, [26.25, 51.5, 76.75, 102]);
  assert.deepEqual(computeBreaks(values, { classes: 3, method: "quantile" }).breaks, [4, 52, 102]);
  assert.deepEqual(computeBreaks([7, 7, 7], { classes: 5 }).breaks, [7]);
});

test("statistics leave sentinel codes out and say how many", async () => {
  const { values } = await json("./fixtures/corn-sales-values.json");
  const records = values.map((value) => ({ attributes: { CORN_SALES_IN_DOLLARS: value } }));
  const sentinels = [{ field: "CORN_SALES_IN_DOLLARS", value: -1, label: "Not Disclosed", source: "renderer" }];
  const sum = computeStat({ stat: "sum", field: "CORN_SALES_IN_DOLLARS" }, records, { sentinels });
  assert.equal(sum.excluded, 546);
  assert.equal(sum.value, values.filter((value) => value > 0).reduce((total, value) => total + value, 0));
  assert.equal(computeStat({ stat: "min", field: "CORN_SALES_IN_DOLLARS" }, records, { sentinels }).value, 0);
  assert.equal(computeStat({ stat: "min", field: "CORN_SALES_IN_DOLLARS" }, records, { sentinels, excludeSentinels: false }).value, -1);
  assert.equal(computeStat({ stat: "count", field: "CORN_SALES_IN_DOLLARS" }, records, { exclude: [-1] }).value, 3074 - 546);
});

test("errors carry a code and an actionable hint", () => {
  const error = new GisMapError("TOO_MANY_LAYERS", "Too many.");
  assert.deepEqual(Object.keys(error.toJSON()), ["name", "code", "message", "hint"]);
  assert.equal(toGisMapError(new Error("Shared layers must use HTTPS.")).code, "HTTPS_REQUIRED");
  assert.equal(toGisMapError(new Error("Remove the credential parameter “token” before sharing this layer.")).code, "CREDENTIAL_IN_URL");
  assert.equal(toGisMapError(new TypeError("Failed to fetch")).code, "CORS_BLOCKED");
  assert.equal(layerLoadError(new Error("Invalid URL")).code, "LAYER_LOAD_FAILED", "a server's 'Invalid URL' for a missing service is a load failure");
  for (const hint of Object.values(ERROR_CODES)) assert.ok(hint.length > 20 && /[.!]$/.test(hint));
});

test("tool inputs and filters are checked before anything runs", () => {
  const add = LAYER_TOOL_DEFINITIONS.find((tool) => tool.id === "layer.add").inputSchema;
  assert.equal(checkToolInput(add, {}), '"url" is required.');
  assert.equal(checkToolInput(add, { url: CORN, type: "shapefile" }), '"type" must be one of: arcgis-auto, feature, map-image, imagery, geojson, wms, wfs, kml.');
  assert.equal(checkToolInput(add, { url: CORN, opacity: "half" }), '"opacity" must be number.');
  assert.equal(checkToolInput(add, { url: CORN }), true);
  assert.equal(checkWhere("CORN_SALES_IN_DOLLARS >= 0 AND state_name = 'Iowa'"), "CORN_SALES_IN_DOLLARS >= 0 AND state_name = 'Iowa'");
  for (const where of ["1=1; DROP TABLE x", "1=1 -- comment", "DELETE FROM t"]) assert.throws(() => checkWhere(where), (error) => error.code === "INVALID_SPEC");
});

test("links choose where the map looks: fit the data by default, or a centre and scale", () => {
  assert.deepEqual(parseShareParameters(`?layer=${encodeURIComponent(CORN)}`).camera, { zoom: "layers", center: null, scale: null, level: null });
  assert.equal(parseShareParameters(`?layer=${encodeURIComponent(CORN)}&zoom=none`).camera.zoom, "none");
  assert.deepEqual(parseShareParameters("?center=-93.6,42&level=7").camera, { zoom: "none", center: [-93.6, 42], scale: null, level: 7 });
  assert.equal(parseShareParameters("?center=-93.6,42&scale=500000").camera.scale, 500000);
  assert.throws(() => parseShareParameters("?zoom=everything"), /zoom mode/);
  assert.throws(() => parseShareParameters("?center=200,10"), /longitude,latitude/);
  assert.throws(() => parseShareParameters("?level=7"), /need a center/);
});

// A tiny stand-in for the map controller: layers are plain objects.
function fakeMap() {
  const layers = [];
  let next = 0;
  const controller = {
    layers,
    modules: {},
    getOperationalLayers: () => layers.slice(),
    getLayerConfig: (layer) => ({ url: layer.configUrl, sourceType: "arcgis-auto", definitionExpression: layer.definitionExpression || null, styled: false }),
    scaleState: () => ({ visibleAtCurrentScale: true, serviceMinScale: 0, serviceMaxScale: 144447, ignored: false }),
    layerMetadata: () => ({ dataLastEditDate: "2022-08-20T02:01:54.133Z", sentinels: [] }),
    removeLayer: (uid) => { const index = layers.findIndex((layer) => layer.uid === uid); if (index >= 0) layers.splice(index, 1); },
    goToLayers: async () => true,
    setDefinitionExpression: (uid, where) => { layers.find((layer) => layer.uid === uid).definitionExpression = where; },
  };
  const loadLayer = async ({ url }) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (/missing/.test(url)) throw new Error("Invalid URL");
    // ArcGIS reports the service URL without the /0 sublayer; the config keeps it.
    const layer = { uid: `layer-${next += 1}`, title: "Corn", type: "feature", loadStatus: "loaded", url: url.replace(/\/\d+$/, ""), layerId: 0, configUrl: url, visible: true, opacity: 1, queryFeatures() {} };
    layers.push(layer);
    return [layer];
  };
  return { controller, loadLayer };
}

test("layers.add loads through the shared pipeline, matches either URL form and enforces the limit under concurrency", async () => {
  const { controller, loadLayer } = fakeMap();
  const layers = createLayersApi({ mapController: controller, loadLayer });
  const info = await layers.add(CORN, { zoomTo: false });
  assert.equal(info.url, CORN, "LayerInfo keeps the /0 form");
  assert.equal(info.type, "feature");
  assert.equal(layers.get(CORN.replace(/\/0$/, "")).id, info.id, "the service URL without /0 finds it too");
  assert.equal(layers.get(`${CORN}/`).id, info.id);
  const results = await Promise.all(Array.from({ length: 11 }, (_, index) => layers.add(`${CORN}?copy=${index}`, { zoomTo: false }).then(() => "ok", (error) => error.code)));
  assert.equal(results.filter((result) => result === "ok").length, 9);
  assert.deepEqual(results.filter((result) => result !== "ok"), ["TOO_MANY_LAYERS", "TOO_MANY_LAYERS"]);
  assert.equal(layers.list().length, 10);
  await assert.rejects(layers.add("http://example.org/FeatureServer/0"), (error) => error.code === "HTTPS_REQUIRED");
  assert.equal(layers.remove(info.id), true);
  await assert.rejects(layers.add("https://example.org/arcgis/rest/services/missing/FeatureServer/0"), (error) => error.code === "LAYER_LOAD_FAILED" && /pjson/.test(error.hint));
});

test("briefing.load never silently skips its layer: it loads it, or says why not", async () => {
  const projectManager = {
    current: { name: "P", presentation: { template: "standard", briefing: { schemaVersion: 1, queries: {}, slides: [] } } },
    setPresentation(value) { this.current.presentation = value; return value; },
    patchPresentation(value) { this.current.presentation = { ...this.current.presentation, ...value }; return this.current.presentation; },
    snapshot() { return structuredClone(this.current); },
  };
  const { controller, loadLayer } = fakeMap();
  const document = { schemaVersion: 1, layerId: CORN, slides: [] };
  // No app (headless): a warning, and `ready` resolves with no layers.
  const headless = createClientApi({ projectManager, mapController: controller });
  const offline = headless.briefing.load(document, { activate: false });
  assert.ok(offline.issues.some((issue) => issue.level === "warning" && /layerId was not loaded/.test(issue.message)));
  assert.deepEqual(await offline.ready, { layers: [] });
  // In the app, activate: false still loads the layer (this was a silent no-op before).
  let calls = 0;
  const api = createClientApi({ projectManager, mapController: controller, host: { loadLayer: (config) => { calls += 1; return loadLayer(config); }, layerInfo: (layer) => ({ id: layer.uid, loadStatus: "loaded" }) } });
  const loaded = api.briefing.load(document, { activate: false });
  const { layers } = await loaded.ready;
  assert.equal(calls, 1);
  assert.deepEqual(layers, [{ id: controller.layers[0].uid, loadStatus: "loaded" }]);
  assert.equal(projectManager.current.presentation.template, "standard", "Briefing mode did not open");
  // A layer that cannot load rejects `ready` with a code.
  const failing = api.briefing.load({ ...document, layerId: "https://example.org/arcgis/rest/services/missing/FeatureServer/0" }, { activate: false });
  await assert.rejects(failing.ready, (error) => error.code === "LAYER_LOAD_FAILED");
});

test("the link's basemap is the one the scene starts with, whatever settings say", () => {
  const map = new MapController({ publish() {} });
  map.setInitialBasemap("gray-vector");
  map.setDefaultBasemap("topo-3d");
  map.setBasemap("navigation-dark-3d");
  assert.equal(map.getBasemapId(), "gray-vector");
});

test("the app signals readiness, zooms links to their data, and explains hidden and coded data", async () => {
  const app = await read("../js/app.js");
  const ui = await read("../js/ui.js");
  const ai = await read("../js/ai.js");
  const map = await read("../js/map.js");
  assert.match(app, /dataset\.gismapState = "ready"/);
  assert.match(app, /new CustomEvent\("gismap:ready"/);
  assert.match(app, /mapController\.setInitialBasemap\(/);
  assert.match(app, /goToLayers\(sharedLayers/);
  assert.match(map, /!this\.map\.allLayers\.includes\(layer\)/, "errors from a replaced basemap's layers are not reported");
  assert.match(ui, /Hidden at this zoom \(publisher limit/);
  assert.match(ui, /data-layer-action="ignore-scale"/);
  assert.match(ai, /are codes, not measurements/);
});
