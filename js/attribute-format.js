const DATE_FIELD_TYPES = new Set(["date", "date-only", "timestamp-offset", "time-only"]);
const DATE_FIELD_NAMES = /(?:^|[_\s-])(date|time|timestamp|created|updated|modified)(?:$|[_\s-])/i;

function asDate(value) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
    const date = new Date(milliseconds);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  if (typeof value === "string" && value.trim()) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : date;
  }
  return null;
}

export function formatAttributeValue(value, field = null, fieldName = "") {
  if (value == null || value === "") return "";
  const fieldType = String(field?.type || "").toLowerCase();
  const isDate = DATE_FIELD_TYPES.has(fieldType) || /date|time/.test(fieldType)
    || (!field && DATE_FIELD_NAMES.test(fieldName));
  if (isDate) {
    const date = asDate(value);
    if (date) return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
