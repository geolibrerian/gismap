import test from "node:test";
import assert from "node:assert/strict";
import { featureId, filterRecords, histogram, requestGuard, sortRecords } from "../js/presentation-query.js";

const fields = [
  { name: "OBJECTID", type: "oid" },
  { name: "IncidentName", alias: "Incident name", type: "string" },
  { name: "Acres", type: "double" },
];
const records = [
  { attributes: { OBJECTID: 7, IncidentName: "Alpha Fire", Acres: 12 } },
  { attributes: { OBJECTID: 2, IncidentName: "Beta Fire", Acres: 30 } },
  { attributes: { OBJECTID: 9, IncidentName: "Alpha Ridge", Acres: null } },
];

test("field search and numeric range share one filter result", () => {
  const state = { searchField: "IncidentName", search: "alpha", searchOperator: "contains", chartField: "Acres", rangeMin: 10, rangeMax: 20, scope: "all" };
  assert.deepEqual(filterRecords(records, state, fields).map((record) => featureId(record, "OBJECTID")), ["7"]);
});

test("histogram reports missing values and selected bin bounds", () => {
  const result = histogram(records, "Acres", 4);
  assert.equal(result.missing, 1);
  assert.equal(result.bins.reduce((sum, bin) => sum + bin.count, 0), 2);
  assert.equal(result.min, 12);
  assert.equal(result.max, 30);
});

test("sorting preserves stable IDs rather than row positions", () => {
  const sorted = sortRecords(records, "IncidentName", "desc");
  assert.deepEqual(sorted.map((record) => featureId(record, "OBJECTID")), ["2", "9", "7"]);
});

test("request guard invalidates stale briefing responses", () => {
  const guard = requestGuard();
  const oldRequest = guard.next();
  const currentRequest = guard.next();
  assert.equal(guard.valid(oldRequest), false);
  assert.equal(guard.valid(currentRequest), true);
  guard.cancel();
  assert.equal(guard.valid(currentRequest), false);
});
