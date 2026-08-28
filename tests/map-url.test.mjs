import assert from "node:assert/strict";
import { MapController, parseArcGISFeatureQueryUrl } from "../js/map.js";

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

let navigation;
controller.view = { goTo(value) { navigation = value; } };
await controller.goToFeature({ geometry: { type: "point", x: -120, y: 40 } });
assert.equal(navigation.zoom, 15);
assert.equal(navigation.center.x, -120);

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

console.log("ArcGIS feature query URL tests passed");
