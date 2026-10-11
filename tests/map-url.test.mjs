import assert from "node:assert/strict";
import { MapController, isNavigationAbort, parseArcGISFeatureQueryUrl, parseWfsUrl } from "../js/map.js";
import { readFile } from "node:fs/promises";

const mapSource = await readFile(new URL("../js/map.js", import.meta.url), "utf8");
assert.match(mapSource, /elevationProfile: \["@arcgis\/core\/widgets\/ElevationProfile\.js", \{\}, "utility"\]/);
assert.match(mapSource, /legend: \["@arcgis\/core\/widgets\/Legend\.js", \{\}, "utility"\]/);
assert.match(mapSource, /legend: "#utility-legend-content"/);

assert.equal(isNavigationAbort(new Error("Aborted")), true);
assert.equal(isNavigationAbort(new DOMException("The operation was aborted", "AbortError")), true);
assert.equal(isNavigationAbort(new Error("Camera failed")), false);

const wfs = parseWfsUrl("https://firms.modaps.eosdis.nasa.gov/mapserver/wfs/Canada/YourMapKey/?SERVICE=WFS&REQUEST=GetFeature&VERSION=2.0.0&TYPENAME=ms%3Afires_modis_24hrs&STARTINDEX=0&COUNT=1000&SRSNAME=urn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A4326&BBOX=-90%2C-180%2C90%2C180%2Curn%3Aogc%3Adef%3Acrs%3AEPSG%3A%3A4326&outputformat=csv");
assert.equal(wfs.serviceUrl, "https://firms.modaps.eosdis.nasa.gov/mapserver/wfs/Canada/YourMapKey");
assert.equal(wfs.wfsName, "ms:fires_modis_24hrs");
assert.deepEqual(wfs.customParameters, {});

const parsed = parseArcGISFeatureQueryUrl(
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json",
);

assert.equal(parsed.layerUrl, "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0");
assert.equal(parsed.definitionExpression, undefined);
assert.deepEqual(parsed.outFields, ["*"]);
assert.equal(parsed.requestedOutSpatialReference, "4326");

const filtered = parseArcGISFeatureQueryUrl(
  "https://example.com/arcgis/rest/services/Fires/FeatureServer/2/query?WHERE=STATE%3D%27CA%27&OUTFIELDS=NAME%2CACRES",
);
assert.equal(filtered.definitionExpression, "STATE='CA'");
assert.deepEqual(filtered.outFields, ["NAME", "ACRES"]);
assert.equal(parseArcGISFeatureQueryUrl("https://example.com/FeatureServer/2"), null);

class FakeFeatureLayer {
  constructor(properties) {
    Object.assign(this, properties);
    this.uid = "feature-query-layer";
    this.type = "feature";
  }

  async load() {}
}

class FakeWFSLayer extends FakeFeatureLayer {
  constructor(properties) {
    super(properties);
    this.uid = "wfs-layer";
    this.type = "wfs";
  }
}

const controller = new MapController({ publish() {} });
controller.setDefaultBasemap("hybrid");
assert.equal(controller.getDefaultBasemapId(), "hybrid");
controller.modules.FeatureLayer = FakeFeatureLayer;
controller.modules.WFSLayer = FakeWFSLayer;
controller.map = {
  layers: { length: 1 },
  add(layer) { this.added = layer; },
  allLayers: { find(predicate) { return predicate(controller.map.added) ? controller.map.added : null; } },
};
const layer = await controller.addService({
  url: "https://example.com/arcgis/rest/services/Fires/FeatureServer/2/query?where=STATE%3D%27CA%27&outFields=NAME%2CACRES&outSR=4326&f=json",
  serviceType: "arcgis-auto",
});
assert.equal(layer.url, "https://example.com/arcgis/rest/services/Fires/FeatureServer/2");
assert.equal(layer.definitionExpression, "STATE='CA'");
assert.deepEqual(layer.outFields, ["NAME", "ACRES"]);
assert.match(controller.getLayerConfig(layer).url, /\/query\?/);
controller.setDefinitionExpression(layer.uid, "ACRES >= 1000");
assert.equal(layer.definitionExpression, "ACRES >= 1000");
assert.equal(controller.getLayerConfig(layer).definitionExpression, "ACRES >= 1000");
const cartographicRenderer = {
  type: "class-breaks",
  field: "ACRES",
  classBreakInfos: [{ minValue: 0, maxValue: 1000, symbol: { type: "polygon-3d", symbolLayers: [{ type: "extrude", material: { color: "#176756" } }] } }],
  visualVariables: [{ type: "size", valueExpression: "$feature['ACRES'] * 0.3", axis: "height", valueUnit: "meters" }],
};
layer.renderer = { toJSON: () => structuredClone(cartographicRenderer) };
layer.opacity = 0.65;
layer.visible = false;
layer.elevationInfo = { toJSON: () => ({ mode: "on-the-ground" }) };
const savedCartography = controller.getLayerConfig(layer);
assert.deepEqual(savedCartography.renderer, cartographicRenderer);
assert.equal(savedCartography.opacity, 0.65);
assert.equal(savedCartography.visible, false);
assert.equal(savedCartography.definitionExpression, "ACRES >= 1000");
assert.deepEqual(savedCartography.elevationInfo, { mode: "on-the-ground" });
const restoredCartography = { renderer: null };
controller.restoreRenderer(restoredCartography, savedCartography.renderer);
assert.deepEqual(restoredCartography.renderer, cartographicRenderer);
const greatLakesRenderer = {
  type: "classBreaks",
  field: "GRAPES_ACRES_BEAR_NON_BEAR_TOT",
  minValue: -999,
  visualVariables: [{ type: "sizeInfo", valueExpression: '$feature["GRAPES_ACRES_BEAR_TOT"] * 0.3', valueUnit: "meter" }],
  classBreakInfos: [{
    label: "-999 – 31,265.6",
    classMaxValue: 31265.6,
    symbol: { type: "PolygonSymbol3D", symbolLayers: [{ type: "Extrude", size: 0, material: { color: [217, 238, 232], transparency: 15 } }] },
  }],
};
const convertedGreatLakesRenderer = { type: "class-breaks", convertedFromWebMapJson: true };
let rendererJsonPassedToConverter = null;
controller.modules.rendererJsonUtils = {
  fromJSON(rendererJson) {
    rendererJsonPassedToConverter = rendererJson;
    return convertedGreatLakesRenderer;
  },
};
const restoredGreatLakesLayer = { renderer: null };
controller.restoreRenderer(restoredGreatLakesLayer, greatLakesRenderer);
assert.deepEqual(rendererJsonPassedToConverter, greatLakesRenderer);
assert.equal(restoredGreatLakesLayer.renderer, convertedGreatLakesRenderer);
const directLayer = await controller.addService({
  url: "https://example.com/arcgis/rest/services/Hotspots/FeatureServer/0",
  serviceType: "feature",
});
assert.deepEqual(directLayer.outFields, ["*"]);
const wfsLayer = await controller.addService({
  url: "https://example.com/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAME=demo%3Afires&token=public-key",
  serviceType: "wfs",
});
assert.equal(wfsLayer.url, "https://example.com/wfs");
assert.equal(wfsLayer.name, "demo:fires");
assert.deepEqual(wfsLayer.customParameters, { token: "public-key" });

let navigation;
controller.view = { goTo(value) { navigation = value; } };
await controller.goToFeature({ geometry: { type: "point", x: -120, y: 40 } });
assert.equal(navigation.zoom, 15);
assert.equal(navigation.center.x, -120);

controller.view = {
  camera: { clone: () => ({ heading: 0, tilt: 35 }) },
  goTo: async () => { throw new Error("Aborted"); },
};
assert.equal(await controller.navigate("tilt-up"), null);

controller.view = {
  camera: { clone: () => ({ heading: 143, tilt: 35 }) },
  goTo(value) { navigation = value; },
};
await controller.navigate("north");
assert.equal(navigation.heading, 0);

controller.view = {
  spatialReference: { wkid: 4326 },
  goTo(value) { navigation = value; },
};
await controller.goToLayer({
  fullExtent: { xmin: -180, ymin: -90, xmax: 427603, ymax: 4285332, spatialReference: { wkid: 4326 } },
  createQuery: () => ({}),
  queryFeatures: async () => ({
    features: [
      { geometry: { extent: { xmin: -121, ymin: 39, xmax: -120, ymax: 40, spatialReference: { wkid: 4326 } } } },
      { geometry: { extent: { xmin: 427000, ymin: 4280000, xmax: 428000, ymax: 4290000, spatialReference: { wkid: 4326 } } } },
    ],
  }),
});
assert.equal(navigation.target.xmin, -121);
assert.equal(navigation.target.ymax, 40);

let extentQuery;
await controller.goToLayer({
  fullExtent: { xmin: -12774183, ymin: 0, xmax: 0, ymax: 4439313, spatialReference: { wkid: 3857 } },
  definitionExpression: "Severity = 'High'",
  createQuery: () => ({}),
  queryExtent: async (query) => {
    extentQuery = query;
    return { extent: { xmin: -114.38, ymin: 31.33, xmax: -109.10, ymax: 36.22, spatialReference: { wkid: 4326 } } };
  },
});
assert.equal(extentQuery.where, "Severity = 'High'");
assert.equal(extentQuery.outSpatialReference.wkid, 4326);
assert.equal(navigation.target.xmin, -114.38);
assert.equal(navigation.target.ymax, 36.22);

let highlightedTarget;
let removedHighlights = 0;
const highlightedLayer = { uid: "earthquakes", objectIdField: "OBJECTID" };
controller.view = {
  whenLayerView: async (candidate) => {
    assert.equal(candidate, highlightedLayer);
    return {
      highlight(target) {
        highlightedTarget = target;
        return { remove() { removedHighlights += 1; } };
      },
    };
  },
};
assert.equal(await controller.highlightFeature({
  kind: "feature",
  layerUid: "earthquakes",
  attributes: { OBJECTID: 42 },
  graphic: { layer: highlightedLayer, attributes: { OBJECTID: 42 } },
}, { pulse: false }), true);
assert.equal(highlightedTarget, 42);
controller.clearFeatureHighlight();
assert.equal(removedHighlights, 1);

class FakeGraphic {
  constructor(properties) { Object.assign(this, properties); }
}
let markerGraphics = [];
controller.modules.Graphic = FakeGraphic;
controller.clickFeedbackLayer = {
  removeAll() { markerGraphics = []; },
  add(graphic) { markerGraphics.push(graphic); },
  addMany(graphics) { markerGraphics.push(...graphics); },
};
controller.configureInteractionFeedback({ highlightEnabled: true, clickMarkerEnabled: true, highlightColor: "#ff00aa" });
controller.showClickMarker({ type: "point", x: -112, y: 33 });
assert.equal(markerGraphics.length, 2);
assert.equal(markerGraphics[0].symbol.style, "cross");
assert.equal(markerGraphics[0].symbol.color, "#ff00aa");
assert.equal(markerGraphics[1].symbol.style, "circle");
controller.configureInteractionFeedback({ highlightEnabled: false, clickMarkerEnabled: false, highlightColor: "invalid" });
assert.equal(markerGraphics.length, 0);

console.log("ArcGIS feature query URL tests passed");
