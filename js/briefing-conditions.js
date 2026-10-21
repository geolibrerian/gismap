// Briefing attribute conditions: the operators each kind of field offers, a
// readable label, and the briefing filter (js/briefing-document.js) each
// condition stands for. Dates are whole UTC days, as date-only data is stored.

const DAY = 86400000;

export const CONDITION_OPERATORS = Object.freeze({
  text: [["eq", "is"], ["neq", "is not"], ["in", "is one of"], ["contains", "contains"], ["starts_with", "starts with"], ["is_null", "is empty"], ["is_not_null", "has a value"]],
  number: [["eq", "="], ["neq", "≠"], ["gt", ">"], ["gte", "≥"], ["lt", "<"], ["lte", "≤"], ["between", "between"], ["is_null", "is empty"], ["is_not_null", "has a value"]],
  date: [["on", "on"], ["before", "before"], ["after", "after"], ["between", "between"], ["is_null", "is empty"], ["is_not_null", "has a value"]],
});

const NO_VALUE = new Set(["is_null", "is_not_null"]);
const day = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? Date.parse(`${value}T00:00:00Z`) : NaN);
const number = (value) => (String(value ?? "").trim() === "" ? NaN : Number(value));

/** Conditions use the text, number or date operators; other kinds use text. */
export const conditionKind = (kind) => (kind === "number" || kind === "date" ? kind : "text");

export const operatorsFor = (kind) => CONDITION_OPERATORS[conditionKind(kind)];

/** The operator a new condition on this kind of field starts with. */
export const defaultOperator = (kind) => ({ number: "gte", date: "after" })[conditionKind(kind)] || "eq";

/** Whether a condition is filled in enough to filter. */
export function conditionComplete({ field, op, value, value2 } = {}, kind = "text") {
  if (!field) return false;
  if (NO_VALUE.has(op)) return true;
  const k = conditionKind(kind);
  if (op === "between") return k === "date" ? Number.isFinite(day(value)) && Number.isFinite(day(value2)) : Number.isFinite(number(value)) && Number.isFinite(number(value2));
  if (k === "date") return Number.isFinite(day(value));
  if (k === "number") return Number.isFinite(number(value));
  if (op === "in") return String(value ?? "").split(",").some((item) => item.trim());
  return String(value ?? "").trim() !== "";
}

/** The briefing filter for one condition, or null when it is incomplete. */
export function conditionToFilter(condition, kind = "text") {
  if (!conditionComplete(condition, kind)) return null;
  const { field, op, value, value2 } = condition;
  if (NO_VALUE.has(op)) return { field, op };
  const k = conditionKind(kind);
  const range = (low, high, highOp = "lte") => ({ op: "and", args: [{ field, op: "gte", value: Math.min(low, high) }, { field, op: highOp, value: Math.max(low, high) }] });
  if (k === "date") {
    const start = day(value);
    if (op === "on") return { op: "and", args: [{ field, op: "gte", value: start }, { field, op: "lt", value: start + DAY }] };
    if (op === "before") return { field, op: "lt", value: start };
    if (op === "after") return { field, op: "gte", value: start + DAY };
    if (op === "between") {
      const end = day(value2);
      return { op: "and", args: [{ field, op: "gte", value: Math.min(start, end) }, { field, op: "lt", value: Math.max(start, end) + DAY }] };
    }
    return null;
  }
  if (k === "number") {
    if (op === "between") return range(number(value), number(value2));
    return { field, op, value: number(value) };
  }
  if (op === "in") return { field, op: "in", values: String(value).split(",").map((item) => item.trim()).filter(Boolean) };
  return { field, op, value: String(value).trim() };
}

/** "Acres between 1,000 and 50,000", for summaries and agents. */
export function conditionLabel(condition, kind = "text", alias = condition.field) {
  const label = Object.fromEntries(operatorsFor(kind))[condition.op] || condition.op;
  if (NO_VALUE.has(condition.op)) return `${alias} ${label}`;
  if (condition.op === "between") return `${alias} between ${condition.value} and ${condition.value2}`;
  return `${alias} ${label} ${condition.value}`;
}
