// The MapLibre preview engine: its pure helpers (where clauses, GeoJSON,
// basemaps, the engine choice) and the engine itself over a stand-in map.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { compileWhere } from "../js/engines/maplibre/where.js";
import { OBJECT_ID_FIELD, boundsOf, geometryTypeOf, inferFields, normalizeFeatures, representativePoint } from "../js/engines/maplibre/geojson.js";
import { openBasemapFor } from "../js/engines/maplibre/basemaps.js";
import { MAPLIBRE_CAPABILITIES, MaplibreEngine } from "../js/engines/maplibre/maplibre-engine.js";
import { HILLSHADE_LAYER_ID, HILLSHADE_SOURCE_ID, TERRAIN_SOURCE_ID, TERRAIN_TILEJSON, hillshadeLayer, maplibreGround, terrainSource } from "../js/engines/maplibre/terrain.js";
import { chooseEngine, saveEngine, savedEngine } from "../js/engine-preference.js";
import { ENGINE_METHODS } from "../js/engines/engine-interface.js";
import { getEngineDefinition, listEngines } from "../js/engines/engine-registry.js";
import { MapController } from "../js/map-controller.js";

test("where clauses run against GeoJSON properties as services would run them", () => {
  const rows = [
    { NAME: "Fenway Park", STATE: "MA", CAPACITY: 37755, OPENED: 1912 },
    { NAME: "Wrigley Field", STATE: "IL", CAPACITY: 41649, OPENED: 1914 },
    { NAME: "Oracle Park", STATE: "CA", CAPACITY: 41915, OPENED: 2000 },
    { NAME: "Petco Park", STATE: "CA", CAPACITY: null, OPENED: 2004 },
  ];
  const names = (where) => rows.filter(compileWhere(where)).map((row) => row.NAME);
  assert.equal(names("").length, 4);
  assert.equal(names("1=1").length, 4);
  assert.deepEqual(names("STATE = 'CA'"), ["Oracle Park", "Petco Park"]);
  assert.deepEqual(names("state = 'CA' AND capacity > 40000"), ["Oracle Park"], "field names match case-insensitively");
  assert.deepEqual(names("(STATE = 'MA' OR STATE = 'IL') AND NOT OPENED < 1913"), ["Wrigley Field"]);
  assert.deepEqual(names("NAME LIKE '%park'"), ["Fenway Park", "Oracle Park", "Petco Park"]);
  assert.deepEqual(names("STATE IN ('MA', 'IL')"), ["Fenway Park", "Wrigley Field"]);
  assert.deepEqual(names("STATE NOT IN ('MA', 'IL')"), ["Oracle Park", "Petco Park"]);
  assert.deepEqual(names("CAPACITY IS NULL"), ["Petco Park"]);
  assert.deepEqual(names("CAPACITY BETWEEN 40000 AND 42000"), ["Wrigley Field", "Oracle Park"]);
  assert.deepEqual(names("CAPACITY <> 37755"), ["Wrigley Field", "Oracle Park"], "null never compares equal or unequal");
  assert.deepEqual(names("\"NAME\" = 'O''Malley'"), [], "quoted names and doubled quotes");
  assert.deepEqual(names("UPPER(NAME) = 'PETCO PARK'"), ["Petco Park"]);
  assert.deepEqual(names("OPENED > -1"), names("1=1"));
  for (const bad of ["STATE = ", "STATE = 'CA", "STATE ~ 'CA'", "STATE = 'CA' ORDER"]) {
    assert.throws(() => compileWhere(bad), (error) => error.code === "INVALID_SPEC", bad);
  }
});

test("GeoJSON features get object IDs, fields, a geometry type, bounds and representative points", () => {
  const features = normalizeFeatures({ type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [4, 0], [4, 2], [0, 2], [0, 0]]] }, properties: { NAME: "A", POP: 10 } },
    { type: "Feature", geometry: { type: "Polygon", coordinates: [[[10, 10], [12, 10], [12, 12], [10, 12], [10, 10]]] }, properties: { NAME: "B", POP: 2.5, NOTE: null } },
  ] });
  assert.deepEqual(features.map((feature) => [feature.id, feature.properties[OBJECT_ID_FIELD]]), [[1, 1], [2, 2]]);
  assert.deepEqual(inferFields(features).map((field) => [field.name, field.type]), [[OBJECT_ID_FIELD, "oid"], ["NAME", "string"], ["POP", "double"], ["NOTE", "string"]]);
  assert.equal(geometryTypeOf(features), "polygon");
  assert.deepEqual(boundsOf(features.map((feature) => feature.geometry)), [0, 0, 12, 12]);
  assert.deepEqual(representativePoint(features[0].geometry), { longitude: 2, latitude: 1 });
  assert.deepEqual(representativePoint({ type: "Point", coordinates: [-71.1, 42.3] }), { longitude: -71.1, latitude: 42.3 });
  assert.deepEqual(boundsOf({ x: 5, y: 6, spatialReference: { wkid: 4326 } }), [5, 6, 5, 6], "ArcGIS JSON points are read too");
  assert.equal(normalizeFeatures({ type: "Point", coordinates: [1, 2] }).length, 1);
  assert.throws(() => normalizeFeatures({ hello: "world" }), /not GeoJSON/);
});

test("GIS Map basemap ids open on key-free OpenFreeMap styles", () => {
  assert.equal(openBasemapFor("topo-3d").key, "liberty");
  assert.equal(openBasemapFor("dark-gray-vector").key, "dark");
  assert.equal(openBasemapFor("gray-vector").key, "positron");
  assert.equal(openBasemapFor("streets-vector").key, "bright");
  assert.deepEqual([openBasemapFor("satellite").key, openBasemapFor("satellite").approximate], ["liberty", true]);
  assert.match(openBasemapFor("topo-3d").style, /^https:\/\/tiles\.openfreemap\.org\/styles\//);
});

test("MapLibre is the default; ?engine= picks an engine for one visit and settings save one", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value), removeItem: (key) => store.delete(key) };
  const available = ["arcgis", "maplibre"];
  assert.equal(chooseEngine({ search: "", storage, available }), "maplibre");
  assert.equal(chooseEngine({ search: "?engine=maplibre", storage, available }), "maplibre");
  assert.equal(chooseEngine({ search: "?engine=leaflet", storage, available }), "maplibre", "unknown engines are ignored");
  saveEngine(storage, "arcgis");
  assert.equal(savedEngine(storage, available), "arcgis");
  assert.equal(chooseEngine({ search: "?engine=maplibre", storage, available }), "maplibre", "the link wins over the saved choice");
  saveEngine(storage, "maplibre");
  assert.equal(store.size, 0, "the default is stored as no choice");
  const throwing = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  assert.equal(chooseEngine({ search: "", storage: throwing, available }), "maplibre");
  assert.doesNotThrow(() => saveEngine(throwing, "arcgis"));
});

test("the MapLibre engine is registered lazily and implements the renderer contract", async () => {
  assert.deepEqual(listEngines().map((engine) => engine.id), ["arcgis", "maplibre"]);
  assert.deepEqual(getEngineDefinition("maplibre").capabilities, [...MAPLIBRE_CAPABILITIES], "the registry advertises what the engine has");
  for (const name of ENGINE_METHODS) assert.equal(typeof MaplibreEngine.prototype[name], "function", `MaplibreEngine.${name}`);
  const [registry, engine, app] = await Promise.all(["js/engines/engine-registry.js", "js/engines/maplibre/maplibre-engine.js", "js/app.js"].map((file) => readFile(new URL(`../${file}`, import.meta.url), "utf8")));
  assert.match(registry, /id: "maplibre"[\s\S]*?await import\("\.\/maplibre\/maplibre-engine\.js/, "loaded only when chosen");
  assert.doesNotMatch(engine, /@arcgis|\$arcgis/);
  assert.match(app, /initialize\(\{ runtime: engineId === "arcgis" \}\)/, "MapLibre maps do not download the ArcGIS runtime for sign-ins");
});

/** A stand-in for maplibregl.Map with just what the engine calls. */
function fakeMap() {
  const sources = new Map();
  const layers = new Map();
  const listeners = new Map();
  let camera = { center: { lng: -98.5, lat: 39.5 }, zoom: 3, bearing: 0, pitch: 0 };
  let terrain = null;
  let sky = null;
  const canvas = { style: { cursor: "" } };
  return {
    sources, layers,
    getCanvas: () => canvas,
    on(type, listener) { listeners.set(type, listener); },
    emit(type, event) { listeners.get(type)?.(event); },
    dragPan: { enable() {}, disable() {} },
    addSource: (id, spec) => sources.set(id, { ...spec, setData(data) { this.data = data; } }),
    getSource: (id) => sources.get(id),
    removeSource: (id) => sources.delete(id),
    addLayer: (spec, before) => layers.set(spec.id, { ...structuredClone(spec), ...(before ? { before } : {}) }),
    getLayer: (id) => layers.get(id),
    removeLayer: (id) => layers.delete(id),
    setFilter: (id, filter) => { layers.get(id).filter = filter; },
    setLayoutProperty: (id, name, value) => { layers.get(id).layout[name] = value; },
    setPaintProperty: (id, name, value) => { layers.get(id).paint[name] = value; },
    setTerrain: (value) => { terrain = value; },
    getTerrain: () => terrain,
    setSky: (value) => { sky = value; },
    getSky: () => sky,
    getStyle: () => ({ layers: [...layers.values()] }),
    isStyleLoaded: () => true,
    setStyle() {
      // MapLibre removes terrain sources and layers while replacing a style.
      terrain = null;
      sky = null;
      sources.clear();
      layers.clear();
      const listener = listeners.get("style.load");
      listeners.delete("style.load");
      listener?.();
    },
    getBounds: () => ({ getWest: () => -10, getSouth: () => -10, getEast: () => 10, getNorth: () => 10 }),
    getCenter: () => camera.center,
    getZoom: () => camera.zoom,
    getBearing: () => camera.bearing,
    getPitch: () => camera.pitch,
    jumpTo(options) { camera = { center: options.center ? { lng: options.center[0], lat: options.center[1] } : camera.center, zoom: options.zoom ?? camera.zoom, bearing: options.bearing ?? camera.bearing, pitch: options.pitch ?? camera.pitch }; },
    once(type, listener) { if (type === "load") queueMicrotask(listener); else listeners.set(type, listener); },
    loaded: () => true,
  };
}

test("MapLibre drawing creates visible terrain-draped graphics and exports them", async () => {
  const map = fakeMap();
  const oldMaplibre = globalThis.maplibregl;
  const oldFetch = globalThis.fetch;
  globalThis.maplibregl = { Map: function () { return map; } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 8, sources: {}, layers: [] }) });
  const published = [];
  try {
    const engine = new MaplibreEngine({ publish: (topic, payload) => published.push([topic, payload]) });
    await engine.initialize();
    const click = (lng, lat) => map.emit("click", { lngLat: { lng, lat }, point: { x: 0, y: 0 } });
    engine.draw("point");
    assert.equal(map.getCanvas().style.cursor, "crosshair");
    click(1, 2);
    assert.equal(map.getCanvas().style.cursor, "", "the cursor is restored when drawing finishes");
    engine.draw("polyline");
    click(0, 0); click(1, 1);
    assert.equal(map.getSource("gismap-drawings").data.features.length, 4, "vertices and the in-progress line are visible before completion");
    map.emit("dblclick", { preventDefault() {} });
    engine.draw("polygon");
    click(0, 0); click(2, 0); click(2, 2);
    map.emit("dblclick", { preventDefault() {} });
    engine.draw("rectangle");
    assert.equal(map.getCanvas().style.cursor, "crosshair");
    map.emit("mousedown", { lngLat: { lng: 0, lat: 0 } });
    map.emit("mouseup", { lngLat: { lng: 1, lat: 1 } });
    assert.equal(map.getCanvas().style.cursor, "");
    assert.equal(engine.hasDrawings(), true);
    assert.equal(map.getSource("gismap-drawings").data.features.length, 4);
    assert.deepEqual([...map.layers.keys()].filter((id) => id.startsWith("gismap-drawings")), ["gismap-drawings-fill", "gismap-drawings-line", "gismap-drawings-point"]);
    for (const id of ["gismap-drawings-fill", "gismap-drawings-line", "gismap-drawings-point"]) {
      assert.ok(!Object.keys(map.getLayer(id).paint).some((key) => key.endsWith("z-offset")));
    }
    assert.deepEqual(engine.getDrawGraphicsForExport().map(({ geometry }) => geometry.type), ["Point", "LineString", "Polygon", "Polygon"]);
    assert.equal(engine.getDrawGraphicsForExport()[0].attributes.drawing_id, 1);
    assert.equal(published.filter(([topic]) => topic === "draw:complete").length, 4);
    map.getCanvas().style.cursor = "pointer";
    engine.draw("polygon");
    engine.draw("polyline");
    assert.equal(map.getCanvas().style.cursor, "crosshair", "switching tools keeps the crosshair");
    engine.clearDrawings();
    assert.equal(map.getCanvas().style.cursor, "pointer", "clearing restores the previous cursor");
    assert.equal(engine.hasDrawings(), false);
    assert.equal(map.getSource("gismap-drawings").data.features.length, 0);
  } finally {
    globalThis.maplibregl = oldMaplibre;
    globalThis.fetch = oldFetch;
  }
});

test("MapLibre measures distance, clears, and restores the cursor on close", async () => {
  const map = fakeMap();
  const handlers = {};
  const output = { textContent: "" };
  const panel = { setAttribute() {}, remove() { this.removed = true; }, querySelector(selector) { return selector === "output" ? output : { addEventListener(_type, fn) { handlers[selector] = fn; } }; } };
  map.getContainer = () => ({ append() {} });
  const previous = { document: globalThis.document, maplibregl: globalThis.maplibregl, fetch: globalThis.fetch };
  globalThis.document = { createElement: () => panel };
  globalThis.maplibregl = { Map: function () { return map; } };
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ version: 8, sources: {}, layers: [] }) });
  try {
    const engine = new MaplibreEngine({ publish() {} });
    await engine.initialize();
    assert.equal(engine.toggleWidget("measurement"), true);
    assert.equal(map.getCanvas().style.cursor, "crosshair");
    for (const lng of [0, 1]) map.emit("click", { lngLat: { lng, lat: 0 }, point: { x: 0, y: 0 } });
    assert.match(output.textContent, /^111\.20 km · 69\.09 mi$/);
    assert.equal(map.getSource("gismap-measurement").data.features.length, 3);
    handlers["[data-measure-clear]"]();
    assert.equal(output.textContent, "0 m · 0 ft");
    engine.draw("point");
    assert.equal(engine.widgetOpen("measurement"), false);
    assert.equal(map.getCanvas().style.cursor, "crosshair");
    assert.equal(map.getSource("gismap-measurement"), undefined);
    map.emit("click", { lngLat: { lng: 0, lat: 0 }, point: { x: 0, y: 0 } });
    assert.equal(map.getCanvas().style.cursor, "");
  } finally {
    Object.assign(globalThis, previous);
  }
});

test("ArcGIS sketches ignore captured elevation and drape on terrain", async () => {
  const code = await readFile(new URL("../js/engines/arcgis/arcgis-engine.js", import.meta.url), "utf8");
  assert.match(code, /this\.drawLayer = new GraphicsLayer\(\{[\s\S]*?elevationInfo: \{ mode: "on-the-ground" \}/);
  assert.match(code, /new this\.modules\.SketchViewModel\(\{[\s\S]*?defaultCreateOptions: \{ hasZ: false \}/);
});

test("MapLibre terrain uses the official open DEM pattern, survives basemap changes and can be turned off", async () => {
  assert.match(TERRAIN_TILEJSON, /^https:\/\/tiles\.mapterhorn\.com\//);
  assert.deepEqual(terrainSource(), { type: "raster-dem", url: TERRAIN_TILEJSON });
  assert.equal(maplibreGround("flat").terrain, false);
  assert.equal(maplibreGround("unknown").id, "world-elevation");
  assert.equal(hillshadeLayer().source, HILLSHADE_SOURCE_ID);

  const published = [];
  const engine = new MaplibreEngine({ publish: (topic, payload) => published.push([topic, payload]) });
  engine.map = fakeMap();
  engine.setGround("world-elevation");
  assert.deepEqual(engine.map.getTerrain(), { source: TERRAIN_SOURCE_ID, exaggeration: 1 });
  assert.deepEqual(engine.map.getSky(), {});
  assert.ok(engine.map.getSource(TERRAIN_SOURCE_ID));
  assert.ok(engine.map.getLayer(HILLSHADE_LAYER_ID));
  engine.setBasemap("positron");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(engine.map.getTerrain(), { source: TERRAIN_SOURCE_ID, exaggeration: 1 }, "a new style restores terrain immediately");
  assert.ok(engine.map.getSource(TERRAIN_SOURCE_ID));
  engine.setGround("flat");
  assert.equal(engine.map.getTerrain(), null);
  assert.equal(engine.map.getSource(TERRAIN_SOURCE_ID), undefined);
  assert.equal(engine.map.getLayer(HILLSHADE_LAYER_ID), undefined);
  assert.deepEqual(published.filter(([topic]) => topic === "map:ground-changed").map(([topic, payload]) => [topic, payload.id]), [["map:ground-changed", "world-elevation"], ["map:ground-changed", "flat"]]);
});

test("GeoJSON layers draw, filter, query and identify in the browser", async () => {
  const published = [];
  const engine = new MaplibreEngine({ publish: (topic, payload) => published.push([topic, payload]) });
  engine.map = fakeMap();
  const collection = { type: "FeatureCollection", features: [
    { type: "Feature", geometry: { type: "Point", coordinates: [1, 1] }, properties: { NAME: "Inside", KIND: "a", SIZE: 3 } },
    { type: "Feature", geometry: { type: "Point", coordinates: [2, 2] }, properties: { NAME: "Also inside", KIND: "b", SIZE: 1 } },
    { type: "Feature", geometry: { type: "Point", coordinates: [50, 50] }, properties: { NAME: "Outside", KIND: "a", SIZE: 2 } },
  ] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => structuredClone(collection) });
  let layer;
  try {
    layer = await engine.addService({ url: "https://example.org/data/ballparks.geojson", definitionExpression: "SIZE > 0" });
    await assert.rejects(engine.addService({ url: "https://example.org/wfs", serviceType: "wfs" }), (error) => error.details?.capability === "layers-ogc");
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual([layer.title, layer.type, layer.geometryType, layer.objectIdField, layer.queryable, layer.where], ["ballparks", "geojson", "point", OBJECT_ID_FIELD, true, "SIZE > 0"]);
  assert.ok(Object.isFrozen(layer));
  assert.equal(published[0][0], "layer:added");
  assert.equal(published[0][1].layer, layer);
  assert.deepEqual([...engine.map.layers.keys()].map((id) => id.split("-").at(-1)), ["fill", "extrusion", "outline", "line", "circle"]);

  assert.equal(await engine.queryFeatureCount(layer.uid), 3);
  const { features, exceededTransferLimit } = await engine.queryFeatures(layer.uid, { where: "KIND = 'a'", outFields: ["NAME"], orderByFields: ["NAME DESC"], num: 1 });
  assert.deepEqual(features.map((feature) => feature.attributes), [{ NAME: "Outside" }]);
  assert.deepEqual(features[0].geometry, { type: "Point", coordinates: [50, 50] }, "geometry is plain GeoJSON");
  assert.equal(exceededTransferLimit, true);
  assert.deepEqual(await engine.queryObjectIds(layer.uid, { geometry: "view" }), [1, 2], "the view is a bounding box");
  await assert.rejects(engine.queryObjectIds(layer.uid, { geometry: { type: "Polygon", coordinates: [] }, spatialRelationship: "contains" }), (error) => error.details?.capability === "spatial-query");
  const distinct = await engine.queryFeatures(layer.uid, { outFields: ["KIND"], returnDistinctValues: true, returnGeometry: false });
  assert.deepEqual(distinct.features.map((feature) => feature.attributes.KIND), ["a", "b"]);

  engine.setDefinitionExpression(layer.uid, "KIND = 'b'");
  assert.equal(engine.map.sources.get(`gismap-${layer.uid}`).data.features.length, 1, "the filter is applied to the drawn data");
  assert.equal(engine.getLayerConfig(layer).definitionExpression, "KIND = 'b'");
  engine.setDefinitionExpression(layer.uid, "");
  await engine.setFeatureFilter(layer.uid, { objectIds: [2] });
  assert.deepEqual(engine.map.layers.get(`gismap-${layer.uid}-circle`).filter[2], ["in", ["id"], ["literal", [2]]]);
  engine.setVisibility(layer.uid, false);
  engine.setOpacity(layer.uid, 0.5);
  assert.equal(engine.map.layers.get(`gismap-${layer.uid}-circle`).layout.visibility, "none");
  assert.equal(engine.map.layers.get(`gismap-${layer.uid}-circle`).paint["circle-opacity"], 0.5);
  await engine.applyRendererSpec(layer.uid, { type: "simple", color: "#aa3300" });
  assert.equal(engine.map.layers.get(`gismap-${layer.uid}-circle`).paint["circle-color"], "#aa3300");
  assert.equal(engine.getLayerConfig(layer).rendererSpec.color, "#aa3300");
  assert.equal(engine.getLayerConfig(layer).styled, true);
  // Classed styles compile as on ArcGIS and draw as MapLibre data expressions.
  await engine.applyRendererSpec(layer.uid, { type: "choropleth", field: "SIZE", classes: 2, method: "equal-interval" });
  const classed = engine.map.layers.get(`gismap-${layer.uid}-circle`).paint["circle-color"];
  assert.equal(classed[0], "case");
  assert.equal(engine.getLayerConfig(layer).renderer.type, "class-breaks", "projects and links keep the ArcGIS renderer");
  await assert.rejects(engine.applyRendererSpec(layer.uid, { type: "heatmap" }), (error) => error.details?.capability === "renderer-spec");

  engine.setVisibility(layer.uid, true);
  engine.map.queryRenderedFeatures = () => [{ source: `gismap-${layer.uid}`, id: 1, properties: { [OBJECT_ID_FIELD]: 1 } }, { source: `gismap-${layer.uid}`, id: 1, properties: { [OBJECT_ID_FIELD]: 1 } }];
  const results = await engine.identify({ x: 10, y: 20, mapPoint: { longitude: 1, latitude: 1 } });
  assert.equal(results.length, 1, "one result per feature");
  assert.deepEqual([results[0].layerUid, results[0].attributes.NAME, results[0].source.objectIdField], [layer.uid, "Inside", OBJECT_ID_FIELD]);
  assert.deepEqual(engine.geographicCoordinates(results[0].geometry), { longitude: 1, latitude: 1 });

  assert.deepEqual(await engine.dataBounds(), [1, 1, 50, 50]);
  engine.removeLayer(layer.uid);
  assert.equal(engine.getLayers().length, 0);
  assert.equal(engine.map.layers.size, 0);
});

test("MapLibre polygon extrusion supports fixed and field heights and survives renderer restore", async () => {
  const engine = new MaplibreEngine({ publish() {} });
  engine.map = fakeMap();
  const previous = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => ({ type: "FeatureCollection", features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, properties: { HEIGHT: 20 } }] }) });
  let layer;
  try { layer = await engine.addService({ url: "https://example.org/polygons.geojson" }); } finally { globalThis.fetch = previous; }
  await engine.setLayerSymbology(layer.uid, { extrusionEnabled: true, extrusionSource: "fixed", extrusionValue: 250, color: "#bb3366" });
  const extrusion = engine.map.layers.get(`gismap-${layer.uid}-extrusion`);
  assert.equal(extrusion.layout.visibility, "visible");
  assert.equal(extrusion.paint["fill-extrusion-height"], 250);
  assert.equal(extrusion.paint["fill-extrusion-color"], "#bb3366");
  assert.equal(engine.map.layers.get(`gismap-${layer.uid}-fill`).layout.visibility, "none");
  await engine.setLayerSymbology(layer.uid, { extrusionEnabled: true, extrusionSource: "field", extrusionField: "HEIGHT", extrusionMultiplier: 2, color: "#bb3366" });
  assert.deepEqual(extrusion.paint["fill-extrusion-height"], ["max", 0, ["*", ["to-number", ["get", "HEIGHT"], 0], 2]]);
  const saved = engine.getLayerConfig(layer).renderer;
  await engine.applyRendererSpec(layer.uid, { type: "simple", color: "#111111" });
  assert.equal(extrusion.layout.visibility, "none");
  engine.restoreRenderer(layer.uid, saved);
  assert.equal(extrusion.layout.visibility, "visible");
  assert.deepEqual(extrusion.paint["fill-extrusion-height"], ["max", 0, ["*", ["to-number", ["get", "HEIGHT"], 0], 2]]);
  await engine.applyRendererSpec(layer.uid, { type: "choropleth", field: "HEIGHT", ramp: "purples", breaks: [10, 20] });
  await engine.setLayerSymbology(layer.uid, { mode: "graduated", extrusionEnabled: true, extrusionSource: "fixed", extrusionValue: 250, color: "#bb3366" });
  assert.equal(engine.getLayerConfig(layer).renderer.type, "class-breaks");
  assert.equal(extrusion.paint["fill-extrusion-color"][0], "case");
});

test("views persist in GIS Map zoom levels (one above MapLibre's)", async () => {
  const engine = new MaplibreEngine({ publish() {} });
  engine.map = fakeMap();
  await engine.setView({ center: [-122.27, 37.8], zoom: 12, heading: 30, tilt: 20 }, { animate: false });
  assert.equal(engine.map.getZoom(), 11, "MapLibre draws GIS Map zoom 12 at its zoom 11");
  assert.deepEqual(engine.getViewState(), { type: "map", camera: null, center: [-122.27, 37.8], zoom: 12, heading: 30, tilt: 20 });
  await engine.setView({ center: [0, 0], tilt: 80 }, { animate: false });
  assert.equal(engine.map.getPitch(), 80, "terrain views retain a steep presentation tilt");
  // A 3D camera saved by the ArcGIS engine opens on roughly the place it looked at.
  await engine.setView({ camera: { position: { x: -71.1, y: 42.3, z: 2000, spatialReference: { wkid: 4326 } }, heading: 0, tilt: 0 } }, { animate: false });
  assert.deepEqual(engine.map.getCenter(), { lng: -71.1, lat: 42.3 });
  assert.ok(engine.map.getZoom() > 13 && engine.map.getZoom() < 17);
  assert.equal(engine.getCamera().zoom, Math.round(engine.map.getZoom() * 100 + 100) / 100);
});

test("MapController falls back quietly for optional capabilities and reports the rest", async () => {
  const fake = Object.fromEntries(ENGINE_METHODS.map((name) => [name, () => undefined]));
  Object.assign(fake, { id: "flat", getCapabilities: () => ["view-2d"], async initialize() {}, isReady: () => true, getLayers: () => [] });
  const views = [];
  fake.setView = async (target) => views.push(target);
  const controller = new MapController({ publish() {} }, null, { engineId: "flat", engineFactory: async () => fake });
  await controller.initialize();
  assert.equal(await controller.reverseGeocode({ longitude: 1, latitude: 2 }), null, "no geocoder: no address, not an error");
  assert.equal(await controller.highlightFeature({ kind: "feature" }), false);
  assert.equal(controller.widgetOpen("legend"), false);
  assert.doesNotThrow(() => controller.configureInteractionFeedback({}));
  assert.doesNotThrow(() => controller.setTourMarkers([]));
  controller.setGround("flat");
  assert.equal(controller.getGroundId(), "flat", "projects keep the ground choice");
  assert.throws(() => controller.search("Boston"), (error) => error.details?.capability === "geocode");
  assert.throws(() => controller.toggleWidget("legend"), (error) => error.details?.capability === "widgets");
  await controller.restoreView({ camera: { position: { x: 1, y: 2, z: 3 } }, center: [5, 6], zoom: 7, heading: 0, tilt: 0 });
  assert.deepEqual(views.at(-1), { center: [5, 6], zoom: 7, heading: 0, tilt: 0 }, "a flat map uses a saved view's centre, not the 3D eye position");
});

test("MapLibre highlights the selected feature, filled or as an outline only", async () => {
  const sources = new Map();
  const layers = new Map();
  const engine = new MaplibreEngine({ publish() {} });
  engine.map = {
    getSource: (id) => sources.get(id),
    addSource: (id, spec) => sources.set(id, { ...spec, setData(data) { this.data = data; } }),
    addLayer: (spec) => layers.set(spec.id, structuredClone(spec)),
    getLayer: (id) => layers.get(id),
    moveLayer() {},
    setPaintProperty: (id, name, value) => { layers.get(id).paint[name] = value; },
    once() {},
  };
  const polygon = { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] };
  assert.equal(await engine.highlightFeature({ kind: "feature", geometry: polygon }), true);
  assert.deepEqual(sources.get("gismap-highlight").data.features[0].geometry, polygon);
  assert.equal(layers.get("gismap-highlight-fill").paint["fill-opacity"], 0.25);
  engine.configureInteractionFeedback({ highlightColor: "#ff00aa", highlightStyle: "outline" });
  assert.equal(layers.get("gismap-highlight-fill").paint["fill-opacity"], 0, "outline only");
  assert.equal(layers.get("gismap-highlight-line").paint["line-color"], "#ff00aa");
  engine.clearFeatureHighlight();
  assert.equal(sources.get("gismap-highlight").data.features.length, 0);
  engine.configureInteractionFeedback({ highlightEnabled: false });
  assert.equal(await engine.highlightFeature({ kind: "feature", geometry: polygon }), false);
});
