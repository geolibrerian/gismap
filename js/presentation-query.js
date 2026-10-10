export const featureId = (record, idField) => {
  const value = idField && record?.attributes?.[idField];
  return value == null ? null : String(value);
};

export const fieldKind = (field = {}) => {
  const type = String(field.type || "").toLowerCase();
  if (type.includes("date")) return "date";
  if (/integer|double|single|long|small/.test(type)) return "number";
  if (type.includes("boolean")) return "boolean";
  return "text";
};

export function matchesSearch(value, query, operator = "contains", kind = "text") {
  if (!query) return true;
  if (operator === "missing") return value == null || value === "";
  if (value == null) return false;
  if (kind === "number") {
    const actual = Number(value);
    const expected = Number(query);
    if (!Number.isFinite(actual) || !Number.isFinite(expected)) return false;
    if (operator === "gt") return actual > expected;
    if (operator === "lt") return actual < expected;
    return actual === expected;
  }
  const actual = String(value).toLocaleLowerCase();
  const expected = String(query).toLocaleLowerCase();
  if (operator === "equals") return actual === expected;
  if (operator === "starts") return actual.startsWith(expected);
  return actual.includes(expected);
}

export function filterRecords(records, state, fields, intersects) {
  const searchable = state.searchField === "*"
    ? fields.filter((field) => fieldKind(field) === "text").map((field) => field.name)
    : [state.searchField].filter(Boolean);
  const searchKind = fieldKind(fields.find((field) => field.name === state.searchField));
  return records.filter((record) => {
    const attrs = record.attributes || {};
    const searchMatch = !state.search || searchable.some((name) => matchesSearch(attrs[name], state.search, state.searchOperator, state.searchField === "*" ? "text" : searchKind));
    const rawValue = attrs[state.chartField];
    const value = rawValue == null || rawValue === "" ? NaN : Number(rawValue);
    const rangeMatch = (state.rangeMin == null || (Number.isFinite(value) && value >= state.rangeMin))
      && (state.rangeMax == null || (Number.isFinite(value) && value <= state.rangeMax));
    const extentMatch = state.scope !== "extent" || !intersects || intersects(record);
    return searchMatch && rangeMatch && extentMatch;
  });
}

export function histogram(records, field, binCount = 12) {
  const values = records.map((record) => {
    const value = record.attributes?.[field];
    return value == null || value === "" ? NaN : Number(value);
  }).filter(Number.isFinite);
  const missing = records.length - values.length;
  if (!values.length) return { bins: [], min: null, max: null, missing };
  const min = Math.min(...values);
  const max = Math.max(...values);
  const count = Math.max(4, Math.min(30, Number(binCount) || 12));
  const bins = Array.from({ length: count }, (_, index) => ({
    min: min + (max - min) * index / count,
    max: min + (max - min) * (index + 1) / count,
    count: 0,
  }));
  values.forEach((value) => {
    const index = max === min ? 0 : Math.min(count - 1, Math.floor((value - min) / (max - min) * count));
    bins[index].count += 1;
  });
  return { bins, min, max, missing };
}

export function sortRecords(records, field, direction = "asc") {
  const sign = direction === "desc" ? -1 : 1;
  return [...records].sort((left, right) => {
    const a = left.attributes?.[field];
    const b = right.attributes?.[field];
    if (a == null) return b == null ? 0 : 1;
    if (b == null) return -1;
    return sign * (typeof a === "number" && typeof b === "number"
      ? a - b
      : String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" }));
  });
}

export const requestGuard = () => {
  let current = 0;
  return {
    next: () => ++current,
    valid: (token) => token === current,
    cancel: () => ++current,
  };
};
