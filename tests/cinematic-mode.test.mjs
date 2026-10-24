import test from "node:test";
import assert from "node:assert/strict";
import { CinematicModeController } from "../js/cinematic/mode.js";

test("cinematic mode applies transient observed IDs and restores the prior filter", async () => {
  const applied = [];
  const layer = { uid: "perimeters", title: "Perimeters", queryable: true, objectIdField: "OBJECTID", maxRecordCount: 100 };
  const mapController = {
    getLayer: (id) => id === "perimeters" ? layer : null,
    getFeatureFilter: async () => ({ objectIds: [99] }),
    setFeatureFilter: async (_id, filter) => { applied.push(filter); return true; },
    queryFeatures: async () => ({ features: [
      { attributes: { OBJECTID: 1, incident: "a", observed_at: "2024-08-14T00:00:00Z" } },
      { attributes: { OBJECTID: 2, incident: "a", observed_at: "2024-08-15T00:00:00Z" } },
    ] }),
  };
  const mode = new CinematicModeController({ mapController });
  await mode.load({ cinematic: { title: "Observed", layers: [{ layerRef: "perimeters", temporal: { startField: "observed_at", groupField: "incident", featureIdField: "OBJECTID" } }] } });
  assert.deepEqual(applied.at(-1), { objectIds: [1] });
  mode.seekObservation(1);
  await mode.renderTask;
  assert.deepEqual(applied.at(-1), { objectIds: [2] });
  mode.setTimeMode("cumulative");
  await mode.renderTask;
  assert.deepEqual(applied.at(-1), { objectIds: [1, 2] });
  await mode.destroy();
  assert.deepEqual(applied.at(-1), { objectIds: [99] });
});
