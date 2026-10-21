// Briefing filters (js/briefing-document.js) as a read-only SQL where clause
// that ArcGIS services and the MapLibre where parser both accept. Field names
// are checked against the layer; values are always literals, never SQL.
import { fieldKind } from "./presentation-query.js?v=0.30.0";
import { conditionToFilter } from "./briefing-conditions.js?v=0.1.0";

const FIELD_NAME = /^[A-Za-z_][\w.]*$/;
const COMPARE = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };

const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const timestamp = (ms) => `TIMESTAMP '${new Date(ms).toISOString().slice(0, 19).replace("T", " ")}'`;

/** The SQL for one briefing filter; throws on unknown fields or operators. */
export function filterToWhere(filter, fields = []) {
  if (!filter) return null;
  if (filter.op === "and" || filter.op === "or") {
    const parts = filter.args.map((arg) => filterToWhere(arg, fields)).filter(Boolean);
    return parts.length > 1 ? `(${parts.join(` ${filter.op.toUpperCase()} `)})` : parts[0] || null;
  }
  if (filter.op === "not") return `NOT (${filterToWhere(filter.arg, fields)})`;
  const field = fields.find((item) => item.name === filter.field);
  if (!field || !FIELD_NAME.test(field.name)) throw new Error(`Unknown field ${filter.field}.`);
  const name = field.name, kind = fieldKind(field);
  const literal = (value) => {
    if (kind === "date") {
      const ms = typeof value === "number" ? value : Date.parse(value);
      if (!Number.isFinite(ms)) throw new Error(`Enter a valid date for ${field.alias || name}.`);
      return timestamp(ms);
    }
    if (kind === "number") {
      const number = Number(value);
      if (!Number.isFinite(number) || value === "" || value == null) throw new Error(`Enter a number for ${field.alias || name}.`);
      return String(number);
    }
    return quote(value);
  };
  if (filter.op === "is_null") return `${name} IS NULL`;
  if (filter.op === "is_not_null") return `${name} IS NOT NULL`;
  if (filter.op === "in" || filter.op === "not_in") return `${name} ${filter.op === "in" ? "IN" : "NOT IN"} (${filter.values.map(literal).join(", ")})`;
  if (filter.op === "contains") return `${name} LIKE ${quote(`%${filter.value}%`)}`;
  if (filter.op === "starts_with") return `${name} LIKE ${quote(`${filter.value}%`)}`;
  if (COMPARE[filter.op]) return `${name} ${COMPARE[filter.op]} ${literal(filter.value)}`;
  throw new Error(`The ${filter.op} condition cannot be used as a layer filter.`);
}

/** Conditions from the filter builder, combined with AND or OR, as one where clause (null when empty). */
export function conditionsToWhere(conditions = [], logic = "and", fields = []) {
  const kindOf = (name) => fieldKind(fields.find((field) => field.name === name));
  const args = conditions.map((condition) => conditionToFilter(condition, kindOf(condition.field))).filter(Boolean);
  if (!args.length) return null;
  return filterToWhere(args.length === 1 ? args[0] : { op: logic === "or" ? "or" : "and", args }, fields);
}
