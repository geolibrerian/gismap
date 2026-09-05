import assert from "node:assert/strict";
import {
  createFeatureCollection,
  geometryToGeoJSON,
  graphicToGeoJSONFeature,
  safeExportName,
} from "../js/export/export-core.js";

assert.deepEqual(
  geometryToGeoJSON({ type: "point", x: -115.14, y: 36.17, z: 620 }),
  { type: "Point", coordinates: [-115.14, 36.17, 620] },
);

assert.deepEqual(
  geometryToGeoJSON({
    type: "point",
    toJSON: () => ({ x: -111.89, y: 40.76, spatialReference: { wkid: 4326 } }),
  }),
  { type: "Point", coordinates: [-111.89, 40.76] },
);

assert.deepEqual(
  geometryToGeoJSON({ type: "polyline", paths: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] }),
  { type: "MultiLineString", coordinates: [[[0, 0], [1, 1]], [[2, 2], [3, 3]]] },
);

const polygon = geometryToGeoJSON({
  type: "polygon",
  rings: [
    [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]],
    [[2, 2], [8, 2], [8, 8], [2, 8], [2, 2]],
  ],
});
assert.equal(polygon.type, "Polygon");
assert.equal(polygon.coordinates.length, 2);

const feature = graphicToGeoJSONFeature({
  geometry: { type: "point", x: -112, y: 33 },
  attributes: { OBJECTID: 7, name: "Test" },
});
assert.deepEqual(feature, {
  type: "Feature",
  geometry: { type: "Point", coordinates: [-112, 33] },
  properties: { OBJECTID: 7, name: "Test" },
});
assert.deepEqual(createFeatureCollection([feature], { name: "Places" }), {
  type: "FeatureCollection",
  name: "Places",
  features: [feature],
});
assert.equal(safeExportName("  Las Végaș / Events  "), "Las-Vegas-Events");
assert.equal(safeExportName("***"), "layer");

console.log("Export conversion tests passed");
