import assert from "node:assert/strict";
import { MapController, parseArcGISFeatureQueryUrl } from "../js/map.js";

const parsed = parseArcGISFeatureQueryUrl(
  "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0/query?where=1%3D1&outFields=*&outSR=4326&f=json",
);

assert.deepEqual(parsed, {
  layerUrl: "https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters/FeatureServer/0",
  definitionExpression: undefined,
  outFields: ["*"],
  requestedOutSpatialReference: "4326",
});

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

const controller = new MapController({ publish() {} });
controller.modules.FeatureLayer = FakeFeatureLayer;
controller.map = {
  layers: { length: 1 },
  add(layer) { this.added = layer; },
};
const layer = await controller.addService({
  url: "https://example.com/arcgis/rest/services/Fires/FeatureServer/2/query?where=STATE%3D%27CA%27&outFields=NAME%2CACRES&outSR=4326&f=json",
  serviceType: "arcgis-auto",
});
assert.equal(layer.url, "https://example.com/arcgis/rest/services/Fires/FeatureServer/2");
assert.equal(layer.definitionExpression, "STATE='CA'");
assert.deepEqual(layer.outFields, ["NAME", "ACRES"]);
assert.match(controller.getLayerConfig(layer).url, /\/query\?/);

console.log("ArcGIS feature query URL tests passed");
