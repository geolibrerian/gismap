import assert from "node:assert/strict";
import {
  createFeatureCollection,
  featureCollectionToKml,
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

const modisWebMercatorPoint = geometryToGeoJSON({
  type: "point",
  x: -10033971.5457,
  y: 4678210.7004,
  spatialReference: { wkid: 102100, latestWkid: 3857 },
});
assert.equal(modisWebMercatorPoint.type, "Point");
assert.ok(Math.abs(modisWebMercatorPoint.coordinates[0] - -90.1367) < 0.0001);
assert.ok(Math.abs(modisWebMercatorPoint.coordinates[1] - 38.69594) < 0.0001);
assert.ok(Math.abs(modisWebMercatorPoint.coordinates[0]) <= 180);
assert.ok(Math.abs(modisWebMercatorPoint.coordinates[1]) <= 90);

const inferredWebMercatorPoint = geometryToGeoJSON({
  type: "point",
  x: -9165280.9939,
  y: 4734007.871,
});
assert.ok(Math.abs(inferredWebMercatorPoint.coordinates[0]) <= 180);
assert.ok(Math.abs(inferredWebMercatorPoint.coordinates[1]) <= 90);

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

const kml = featureCollectionToKml({
  type: "FeatureCollection",
  name: "Drawings & notes",
  features: [{
    type: "Feature",
    geometry: { type: "Point", coordinates: [-118.4, 34.1] },
    properties: { name: "Monitor <A>", value: 10.8 },
  }, {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[-118.5, 34], [-118.4, 34], [-118.4, 34.1], [-118.5, 34]]] },
    properties: { description: "Area & boundary" },
  }],
});
assert.match(kml, /<name>Drawings &amp; notes<\/name>/);
assert.match(kml, /<name>Monitor &lt;A&gt;<\/name>/);
assert.match(kml, /<Point><coordinates>-118\.4,34\.1<\/coordinates><\/Point>/);
assert.match(kml, /<Polygon>/);
assert.match(kml, /Area &amp; boundary/);

console.log("Export conversion tests passed");
