import assert from "node:assert/strict";
import { formatAttributeValue } from "../js/attribute-format.js";

const epoch = Date.UTC(2026, 9, 5, 14, 30, 0);
const formatted = formatAttributeValue(epoch, { type: "date" }, "CreateDate");

assert.notEqual(formatted, String(epoch));
assert.match(formatted, /2026/);
assert.equal(formatAttributeValue(42, { type: "integer" }, "OBJECTID"), "42");
assert.match(formatAttributeValue(epoch, null, "last_updated"), /2026/);
