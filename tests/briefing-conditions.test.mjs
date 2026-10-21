import test from "node:test";
import assert from "node:assert/strict";
import { conditionComplete, conditionLabel, conditionToFilter, defaultOperator, operatorsFor } from "../js/briefing-conditions.js";
import { matchesFilter, normalizeFilter } from "../js/briefing-document.js";

const matches = (condition, kind, attributes) => matchesFilter(normalizeFilter(conditionToFilter(condition, kind)), attributes);

test("each kind of field offers its own operators", () => {
  assert.deepEqual(operatorsFor("number").map(([op]) => op), ["eq", "neq", "gt", "gte", "lt", "lte", "between", "is_null", "is_not_null"]);
  assert.deepEqual(operatorsFor("date").map(([op]) => op), ["on", "before", "after", "between", "is_null", "is_not_null"]);
  assert.ok(operatorsFor("text").some(([op, label]) => op === "in" && label === "is one of"));
  assert.deepEqual(operatorsFor("boolean"), operatorsFor("text"));
  assert.deepEqual([defaultOperator("number"), defaultOperator("date"), defaultOperator("text")], ["gte", "after", "eq"]);
});

test("number between includes both ends, in either order", () => {
  const condition = { field: "ACRES", op: "between", value: "50000", value2: "1000" };
  assert.equal(matches(condition, "number", { ACRES: 1000 }), true);
  assert.equal(matches(condition, "number", { ACRES: 50000 }), true);
  assert.equal(matches(condition, "number", { ACRES: 50001 }), false);
  assert.equal(conditionComplete({ ...condition, value2: "" }, "number"), false);
  assert.equal(conditionLabel(condition, "number", "Acres"), "Acres between 50000 and 1000");
});

test("dates are whole UTC days, for timestamps and ISO text alike", () => {
  const day = Date.UTC(2020, 7, 16);
  const on = { field: "ALARM_DATE", op: "on", value: "2020-08-16" };
  assert.equal(matches(on, "date", { ALARM_DATE: day }), true);
  assert.equal(matches(on, "date", { ALARM_DATE: day + 86399999 }), true);
  assert.equal(matches(on, "date", { ALARM_DATE: day + 86400000 }), false);
  assert.equal(matches(on, "date", { ALARM_DATE: "2020-08-16" }), true);
  assert.equal(matches({ field: "ALARM_DATE", op: "after", value: "2020-08-16" }, "date", { ALARM_DATE: day }), false);
  assert.equal(matches({ field: "ALARM_DATE", op: "after", value: "2020-08-16" }, "date", { ALARM_DATE: "2020-08-17T05:00:00Z" }), true);
  assert.equal(matches({ field: "ALARM_DATE", op: "before", value: "2020-08-16" }, "date", { ALARM_DATE: day - 1 }), true);
  const between = { field: "ALARM_DATE", op: "between", value: "2020-08-01", value2: "2020-08-31" };
  assert.equal(matches(between, "date", { ALARM_DATE: Date.UTC(2020, 7, 31, 23) }), true);
  assert.equal(matches(between, "date", { ALARM_DATE: Date.UTC(2020, 8, 1) }), false);
  assert.equal(conditionToFilter({ field: "ALARM_DATE", op: "on", value: "16/08/2020" }, "date"), null);
});

test("text: is one of, empty checks, and incomplete conditions", () => {
  const oneOf = { field: "STATE", op: "in", value: "CA, OR ,," };
  assert.deepEqual(conditionToFilter(oneOf, "text"), { field: "STATE", op: "in", values: ["CA", "OR"] });
  assert.equal(matches(oneOf, "text", { STATE: "OR" }), true);
  assert.equal(matches(oneOf, "text", { STATE: "NV" }), false);
  assert.equal(matches({ field: "NAME", op: "is_null" }, "text", { NAME: "" }), true);
  assert.equal(conditionToFilter({ field: "NAME", op: "eq", value: "  " }, "text"), null);
  assert.equal(conditionToFilter({ field: "ACRES", op: "gt", value: "lots" }, "number"), null);
});
