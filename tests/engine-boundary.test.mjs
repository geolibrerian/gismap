// The map engine boundary: only the engine (js/engines/arcgis/) touches the
// ArcGIS Maps SDK. Everything else goes through the engine's methods with
// layer handles and plain data (js/engines/engine-interface.js), so another
// engine (MapLibre) can take its place.
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { ENGINE_CAPABILITIES, ENGINE_EVENTS, ENGINE_METHODS, unsupported } from "../js/engines/engine-interface.js";
import { ArcGISEngine, MapController } from "../js/engines/arcgis/arcgis-engine.js";

const root = new URL("../", import.meta.url);

// The modules allowed to use the SDK. Shrink it, never grow it outside js/engines/.
const SDK_ALLOWED = new Set([
  "js/engines/arcgis/arcgis-engine.js",
  "js/engines/arcgis/arcgis-auth.js",
]);

// What only the engine may do, with what it would look like in another module.
const LEAKS = [
  [/@arcgis\/|\$arcgis/, "imports the ArcGIS Maps SDK"],
  [/\bmapController\??\.(?:view|map|modules|layerConfigs|localAssets|drawLayer|tourLayer|locationLayer|clickFeedbackLayer|sketch)\b/, "reads the engine's SDK objects"],
  [/\.view\??\.(?!\w+\s*=>)/, "reads a view (`.view.`)"],
  [/\.(?:findLayer|getOperationalLayers|takeMapScreenshot|searchPlaces|representativePoint|dataExtent)\s*\(/, "calls a pre-engine MapController method that handed out SDK objects"],
  [/(?<!mapController|host)\.(?:createQuery|queryExtent|queryFeatures|queryFeatureCount|queryObjectIds|whenLayerView|hitTest|takeScreenshot|toMap|goTo|zoomIn|zoomOut)\s*\(/, "calls an SDK layer or view method"],
  [/typeof [\w.?]+\.(?:queryFeatures|queryFeatureCount|queryObjectIds|createQuery|queryExtent)\b/, "detects SDK layer methods (use the handle's queryable / countable / objectIdQueryable)"],
  [/\blayerView\b|\.sublayers\b|\.sourceLayer\b|\.allLayers\b|declaredClass|\.graphic\b/, "reaches into SDK layers, layer views or graphics"],
  [/renderer\??\.toJSON\b|\.loadError\.|\blayer\??\.load\??\(/, "uses SDK layer internals (the handle has renderer JSON; use loadLayer)"],
];

async function modules(directory = new URL("js/", root), base = "js/") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name !== "vendor") files.push(...await modules(new URL(`${entry.name}/`, directory), `${base}${entry.name}/`));
    } else if (entry.name.endsWith(".js")) {
      files.push(`${base}${entry.name}`);
    }
  }
  return files;
}

test("only the engine touches the ArcGIS Maps SDK", async () => {
  const leaks = [];
  for (const file of await modules()) {
    if (SDK_ALLOWED.has(file)) continue;
    const lines = (await readFile(new URL(file, root), "utf8")).split("\n");
    lines.forEach((line, index) => {
      // Comments may name SDK things; code may not.
      if (/^\s*(?:\/\/|\/?\*)/.test(line)) return;
      for (const [pattern, what] of LEAKS) {
        if (pattern.test(line)) leaks.push(`${file}:${index + 1} ${what}: ${line.trim().slice(0, 140)}`);
      }
    });
  }
  assert.deepEqual(leaks, [], `Route these through the engine (js/engines/engine-interface.js):\n${leaks.join("\n")}`);
});

test("the allow-list holds engine files only, and each still exists", async () => {
  const files = new Set(await modules());
  for (const file of SDK_ALLOWED) {
    assert.match(file, /^js\/engines\/[\w-]+\//, `${file} is not an engine module`);
    assert.ok(files.has(file), `${file} is gone; take it off the allow-list`);
  }
});

test("the leak patterns catch what they are for", () => {
  const caught = (code) => LEAKS.some(([pattern]) => pattern.test(code));
  for (const code of [
    'import Map from "@arcgis/core/Map.js";',
    "await $arcgis.import(['x']);",
    "this.mapController.view.goTo(target);",
    "const view = mapController.view;",
    "const { features } = await layer.queryFeatures(query);",
    "const query = layer.createQuery();",
    'if (typeof layer.queryFeatures === "function") return;',
    "const layerView = await view.whenLayerView(layer);",
    "this.mapController.findLayer(uid);",
    "for (const layer of mapController.getOperationalLayers()) {}",
    "const renderer = layer.renderer?.toJSON?.();",
    "await layer.load();",
    "const sdk = result.graphic;",
  ]) assert.ok(caught(code), code);
  for (const code of [
    "await this.mapController.queryFeatures(layer.uid, { where });",
    "await mapController.setView({ center }, { animate });",
    "return host.queryFeatures(layer, { where });",
    "const layer = this.mapController.getLayer(uid);",
    "if (!layer?.queryable) return;",
    "const where = layer.where || '1=1';",
  ]) assert.ok(!caught(code), code);
});

test("the ArcGIS engine implements the whole engine contract", () => {
  for (const name of ENGINE_METHODS) assert.equal(typeof ArcGISEngine.prototype[name], "function", `ArcGISEngine.${name}`);
  assert.equal(MapController, ArcGISEngine, "the app's MapController is the ArcGIS engine");
  const engine = new ArcGISEngine({ publish() {} });
  const capabilities = engine.getCapabilities();
  assert.ok(capabilities.every((name) => ENGINE_CAPABILITIES.includes(name)));
  assert.ok(capabilities.includes("view-3d") && !capabilities.includes("view-2d"));
  assert.ok(ENGINE_EVENTS.includes("map:click") && ENGINE_EVENTS.includes("layer:added"));
  const error = unsupported("feature-filter");
  assert.equal(error.code, "UNSUPPORTED_LAYER_TYPE");
  assert.deepEqual(error.details, { capability: "feature-filter" });
});

test("layer handles are read-only plain values over the engine's layer", () => {
  const engine = new ArcGISEngine({ publish() {} });
  const field = { name: "STATE", alias: "State", type: "string", domain: { type: "coded-value", name: "states", codedValues: [{ code: "CA", name: "California" }], toJSON() {} } };
  const sdk = {
    uid: "17", id: "fires", title: "Fires", url: "https://example.com/arcgis/rest/services/Fires/FeatureServer", layerId: 2, type: "feature",
    fields: [field], geometryType: "polygon", objectIdField: "OBJECTID", visible: true, opacity: 0.5, definitionExpression: "ACRES > 10",
    renderer: { toJSON: () => ({ type: "simple" }) }, minScale: 0, maxScale: 0, refreshInterval: 0, loadStatus: "loaded",
    capabilities: { query: { maxRecordCount: 2000, supportsPagination: true } },
    queryFeatures() {}, queryFeatureCount() {},
  };
  const internal = { uid: "draw" };
  engine.map = { layers: { toArray: () => [sdk, internal] }, allLayers: [sdk, internal] };
  engine.drawLayer = internal;
  const [layer] = engine.getLayers();
  assert.equal(engine.getLayers().length, 1, "internal graphics layers are not data layers");
  assert.equal(engine.getLayer("17"), layer, "one handle per layer, so handles compare by identity");
  assert.equal(engine.getLayer("draw"), null);
  assert.deepEqual(
    { uid: layer.uid, title: layer.title, url: layer.url, layerId: layer.layerId, where: layer.where, renderer: layer.renderer, queryable: layer.queryable, countable: layer.countable, objectIdQueryable: layer.objectIdQueryable, maxRecordCount: layer.maxRecordCount },
    { uid: "17", title: "Fires", url: sdk.url, layerId: 2, where: "ACRES > 10", renderer: { type: "simple" }, queryable: true, countable: true, objectIdQueryable: false, maxRecordCount: 2000 },
  );
  assert.deepEqual(layer.fields, [{ name: "STATE", alias: "State", type: "string", domain: { type: "coded-value", name: "states", codedValues: [{ code: "CA", name: "California" }] } }]);
  assert.ok(Object.isFrozen(layer));
  assert.throws(() => { layer.visible = false; }, TypeError);
  engine.setVisibility("17", false, { silent: true });
  assert.equal(layer.visible, false, "changes go through the engine and show in the handle");
  assert.equal(engine.getLayerConfig(layer).uid, "17", "engine methods take handles or uids");
});

test("queries take plain parameters and return plain features", async () => {
  const engine = new ArcGISEngine({ publish() {} });
  const geometry = { x: -120, y: 40, spatialReference: { wkid: 4326 }, toJSON: () => ({ x: -120, y: 40, spatialReference: { wkid: 4326 } }) };
  let received;
  const sdk = {
    uid: "7", definitionExpression: "A = 1",
    createQuery() { return { where: this.definitionExpression, outFields: ["*"] }; },
    async queryFeatures(query) { received = query; return { features: [{ attributes: { A: 1 }, geometry }], exceededTransferLimit: true }; },
  };
  engine.map = { allLayers: [sdk] };
  engine.view = { extent: { xmin: 0 }, spatialReference: { wkid: 3857 } };
  const result = await engine.queryFeatures("7", { outFields: ["A"], geometry: "view", outSpatialReference: "view" });
  assert.deepEqual(received, { where: "A = 1", outFields: ["A"], geometry: engine.view.extent, outSpatialReference: { wkid: 3857 } }, "starts from the layer's own query, filter included");
  assert.deepEqual(result, { features: [{ attributes: { A: 1 }, geometry: { x: -120, y: 40, spatialReference: { wkid: 4326 } } }], exceededTransferLimit: true });
  assert.equal(typeof result.features[0].geometry.toJSON, "undefined", "geometry is plain JSON");
  await engine.queryFeatures("7", { where: "B = 2" }, { layerDefaults: false });
  assert.deepEqual(received, { where: "B = 2" });
  await assert.rejects(engine.queryFeatureCount("7"), (error) => error.details?.capability === "query");
});
