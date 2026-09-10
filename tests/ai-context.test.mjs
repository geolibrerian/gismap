import assert from "node:assert/strict";
import { AI_SYSTEM_PROMPT, buildAIMapContext } from "../js/ai.js";

assert.doesNotMatch(AI_SYSTEM_PROMPT, /use only the supplied map context/i);
assert.match(AI_SYSTEM_PROMPT, /general knowledge/i);
assert.match(AI_SYSTEM_PROMPT, /Do not claim that a specific landmark/i);

const context = buildAIMapContext({
  point: { longitude: -122.23, latitude: 37.56 },
  address: {
    address: "Redwood City, California",
    attributes: {
      PlaceName: "Redwood City",
      Type: "City",
      Score: 100,
      Empty: "",
      Nested: { ignored: true },
    },
  },
  results: [
    { layerTitle: "Landmarks", attributes: { Name: "Example" }, geometry: { type: "point", x: -122.23, y: 37.56, spatialReference: { wkid: 4326 } } },
    { layerTitle: "Parcels", attributes: { Name: "Nearby but not selected" } },
  ],
  selectedResults: [{ layerTitle: "Landmarks", attributes: { Name: "Example", Nested: { ignored: true } }, geometry: { type: "point", x: -122.23, y: 37.56, spatialReference: { wkid: 4326 } } }],
  mapExtent: { west: -122.4, south: 37.4, east: -122.1, north: 37.7, zoom: 12 },
}, [{ title: "Landmarks", type: "feature", url: "https://example.com/FeatureServer/0" }]);

assert.equal(context.address, "Redwood City, California");
assert.deepEqual(context.geocoderDetails, { PlaceName: "Redwood City", Type: "City", Score: 100 });
assert.equal(context.selectedFeatures.length, 1);
assert.equal(context.selectedFeatures[0].attributes.Name, "Example");
assert.equal(context.selectedFeatures[0].attributes.Nested, undefined);
assert.equal(context.selectedFeatures[0].geometry.type, "point");
assert.equal(context.selectedFeatures[0].geometry.spatialReference.wkid, 4326);
assert.equal(context.identifiedFeatureSummary.count, 2);
assert.deepEqual(context.identifiedFeatureSummary.layers, ["Landmarks", "Parcels"]);
assert.equal(context.loadedLayers[0].title, "Landmarks");
assert.deepEqual(context.mapExtent, { west: -122.4, south: 37.4, east: -122.1, north: 37.7, zoom: 12 });

const boundedContext = buildAIMapContext({
  results: [],
  selectedResults: Array.from({ length: 12 }, (_, index) => ({
    layerTitle: `Layer ${index}`,
    attributes: { id: index },
    geometry: { type: "LineString", coordinates: Array.from({ length: 600 }, (_, point) => [point, point]) },
  })),
});
assert.equal(boundedContext.selectedFeatures.length, 10);
assert.equal(boundedContext.selectedFeatures[0].geometry.coordinates.length, 500);
