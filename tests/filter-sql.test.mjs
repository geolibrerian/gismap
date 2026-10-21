import test from "node:test";
import assert from "node:assert/strict";
import { conditionsToWhere, filterToWhere } from "../js/filter-sql.js";
import { conditionToFilter } from "../js/briefing-conditions.js";
import { matchesFilter, normalizeFilter } from "../js/briefing-document.js";
import { compileWhere } from "../js/engines/maplibre/where.js";

const FIELDS = [
  { name: "NAME", type: "esriFieldTypeString", alias: "Name" },
  { name: "ACRES", type: "esriFieldTypeDouble" },
  { name: "ALARM_DATE", type: "esriFieldTypeDate" },
  { name: "STATE", type: "string" },
];

test("conditions compile to escaped SQL with typed literals", () => {
  assert.equal(conditionsToWhere([{ field: "NAME", op: "eq", value: "O'Brien" }], "and", FIELDS), "NAME = 'O''Brien'");
  assert.equal(conditionsToWhere([{ field: "ACRES", op: "between", value: "1000", value2: "50000" }], "and", FIELDS), "(ACRES >= 1000 AND ACRES <= 50000)");
  assert.equal(conditionsToWhere([{ field: "ALARM_DATE", op: "after", value: "2020-08-01" }], "and", FIELDS), "ALARM_DATE >= TIMESTAMP '2020-08-02 00:00:00'");
  assert.equal(conditionsToWhere([{ field: "STATE", op: "in", value: "CA, OR" }], "and", FIELDS), "STATE IN ('CA', 'OR')");
  assert.equal(conditionsToWhere([{ field: "NAME", op: "contains", value: "creek" }, { field: "ACRES", op: "is_null" }], "or", FIELDS), "(NAME LIKE '%creek%' OR ACRES IS NULL)");
  assert.equal(conditionsToWhere([{ field: "NAME", op: "eq", value: "" }], "and", FIELDS), null, "incomplete conditions are left out");
});

test("unknown fields and unsafe names are refused", () => {
  assert.throws(() => filterToWhere({ field: "NAME; DROP", op: "eq", value: "x" }, [{ name: "NAME; DROP", type: "string" }]), /Unknown field/);
  assert.throws(() => filterToWhere({ field: "MISSING", op: "eq", value: "x" }, FIELDS), /Unknown field/);
  assert.throws(() => filterToWhere({ field: "ACRES", op: "eq", value: "lots" }, FIELDS), /Enter a number/);
});

test("compiled SQL selects the same records in the MapLibre parser as the in-memory filter", () => {
  const records = [
    { NAME: "Camp", ACRES: 153336, ALARM_DATE: Date.UTC(2018, 10, 8), STATE: "CA" },
    { NAME: "Creek", ACRES: 379895, ALARM_DATE: Date.UTC(2020, 8, 4), STATE: "CA" },
    { NAME: "Bootleg", ACRES: 413717, ALARM_DATE: Date.UTC(2021, 6, 6), STATE: "OR" },
    { NAME: "Small", ACRES: 12, ALARM_DATE: null, STATE: "NV" },
  ];
  const cases = [
    [[{ field: "ACRES", op: "between", value: "100000", value2: "400000" }], "and"],
    [[{ field: "ALARM_DATE", op: "between", value: "2020-01-01", value2: "2021-12-31" }, { field: "STATE", op: "in", value: "CA,OR" }], "and"],
    [[{ field: "NAME", op: "starts_with", value: "C" }, { field: "ALARM_DATE", op: "is_null" }], "or"],
  ];
  const kinds = { NAME: "text", ACRES: "number", ALARM_DATE: "date", STATE: "text" };
  for (const [conditions, logic] of cases) {
    const sql = compileWhere(conditionsToWhere(conditions, logic, FIELDS));
    const filter = normalizeFilter({ op: logic, args: conditions.map((condition) => conditionToFilter(condition, kinds[condition.field])) });
    const viaSql = records.filter((record) => sql(record)).map((record) => record.NAME);
    const viaFilter = records.filter((record) => matchesFilter(filter, record)).map((record) => record.NAME);
    assert.deepEqual(viaSql, viaFilter, JSON.stringify(conditions));
    assert.ok(viaSql.length > 0);
  }
});
