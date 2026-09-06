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
  results: [{ layerTitle: "Landmarks", attributes: { Name: "Example" } }],
}, [{ title: "Landmarks", type: "feature", url: "https://example.com/FeatureServer/0" }]);

assert.equal(context.address, "Redwood City, California");
assert.deepEqual(context.geocoderDetails, { PlaceName: "Redwood City", Type: "City", Score: 100 });
assert.equal(context.features[0].attributes.Name, "Example");
assert.equal(context.loadedLayers[0].title, "Landmarks");
