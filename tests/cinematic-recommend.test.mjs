import test from "node:test";
import assert from "node:assert/strict";
import { recommendAnimations } from "../js/cinematic/recommend.js";

const ids = (list) => list.map((item) => item.id);

test("utility lines with no date field get Ambient Electric flow first, and no Timeline", () => {
  const lines = { title: "Transmission lines", geometryType: "polyline", fields: [{ name: "OBJECTID", type: "esriFieldTypeOID" }, { name: "VOLTAGE", type: "esriFieldTypeDouble" }] };
  const suggestions = recommendAnimations(lines);
  assert.equal(suggestions[0].id, "ambient-electricity");
  assert.equal(suggestions[0].kind, "none");
  assert.equal(suggestions[0].provenance, "illustrative");
  assert.ok(!suggestions.some((item) => item.kind === "time"), "no Timeline without real dates");
  assert.match(suggestions[0].reason, /do not show measured voltage/);
});

test("dated points lead with an observed Timeline; statistical areas rise to their value", () => {
  const quakes = { title: "Earthquakes", geometryType: "point", fields: [{ name: "time", type: "esriFieldTypeDate" }, { name: "mag", type: "esriFieldTypeDouble" }] };
  const first = recommendAnimations(quakes)[0];
  assert.deepEqual([first.kind, first.field, first.effect, first.provenance, first.timeMode], ["time", "time", "pulse", "observed", "cumulative"]);
  const counties = { title: "County population", geometryType: "polygon", fields: [{ name: "GEOID", type: "esriFieldTypeString" }, { name: "POP2020", type: "esriFieldTypeInteger" }] };
  const rise = recommendAnimations(counties).find((item) => item.effect === "extrude");
  assert.deepEqual([rise.kind, rise.field, rise.provenance], ["none", "POP2020", "observed"]);
  assert.ok(ids(recommendAnimations(counties)).includes("scenario-sweep"), "a number can also be swept as a Scenario");
});

test("every suggestion explains itself and names what it shows", () => {
  const parcels = { title: "Parcels", geometryType: "polygon", fields: [] };
  for (const item of recommendAnimations(parcels)) {
    assert.ok(item.reason.length > 20, item.id);
    assert.ok(["observed", "illustrative"].includes(item.provenance), item.id);
  }
  assert.match(recommendAnimations(parcels).find((item) => item.effect === "reveal").reason, /not a date/);
});
