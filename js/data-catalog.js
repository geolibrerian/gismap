const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const READ_ONLY_START = /^(?:SELECT|WITH|DESCRIBE|EXPLAIN|SHOW|SUMMARIZE)\b/i;
const UNSAFE_SQL = /\b(?:ATTACH|DETACH|INSTALL|LOAD|COPY|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|CALL|PRAGMA|EXPORT|IMPORT|VACUUM|CHECKPOINT|SET|RESET)\b/i;
const SOURCE_FORMATS = new Set(["parquet", "geojson", "json", "csv", "pmtiles", "duckdb-catalog"]);

export function quoteIdentifier(value) {
  const identifier = String(value || "");
  if (!IDENTIFIER.test(identifier)) throw new Error(`Invalid catalog identifier: ${identifier || "(empty)"}`);
  return `"${identifier}"`;
}

export function validateReadOnlySQL(sql) {
  const text = String(sql || "").trim().replace(/;+\s*$/, "");
  if (!text) throw new Error("Enter a query first.");
  if (!READ_ONLY_START.test(text)) throw new Error("Only read-only SELECT, WITH, DESCRIBE, EXPLAIN, SHOW, and SUMMARIZE queries are allowed.");
  if (UNSAFE_SQL.test(text)) throw new Error("This query contains an operation that is not permitted in the browser SQL workspace.");
  if (text.includes(";")) throw new Error("Run one read-only statement at a time.");
  return text;
}

export function normalizeDataCatalog(value = {}) {
  const relations = Array.isArray(value.relations) ? value.relations : [];
  return {
    schema: "https://gismap.online/data-catalog/v1",
    version: String(value.version || "1"),
    id: String(value.id || "project-catalog"),
    title: String(value.title || "Project data catalog"),
    catalogUrl: /^https:\/\//i.test(String(value.catalogUrl || "")) ? String(value.catalogUrl) : null,
    relations: relations.map((relation) => {
      const name = String(relation?.name || "");
      quoteIdentifier(name);
      const source = relation?.source || {};
      const format = String(source.format || "json").toLowerCase();
      if (!SOURCE_FORMATS.has(format)) throw new Error(`Unsupported catalog source format: ${format}`);
      const url = source.url == null ? null : String(source.url);
      if (url && !/^https:\/\//i.test(url)) throw new Error(`Catalog relation “${name}” must use an HTTPS source.`);
      return {
        name,
        title: String(relation.title || name),
        description: String(relation.description || ""),
        source: { format, url, layerId: source.layerId ? String(source.layerId) : null },
        schema: Array.isArray(relation.schema) ? relation.schema.map((field) => ({ name: String(field.name), type: String(field.type || "VARCHAR"), unit: field.unit ? String(field.unit) : null })) : [],
        geometry: relation.geometry ? structuredClone(relation.geometry) : null,
        timeField: relation.timeField ? String(relation.timeField) : null,
      };
    }),
  };
}

export function planNaturalLanguageQuery(prompt, catalog, { limit = 100 } = {}) {
  const request = String(prompt || "").trim();
  if (!request) throw new Error("Describe the records you want to find.");
  const normalized = normalizeDataCatalog(catalog);
  const relation = normalized.relations.find((item) => new RegExp(`\\b${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(request)) || normalized.relations[0];
  if (!relation) throw new Error("Add a catalog relation before building a natural-language query.");
  const numericFields = relation.schema.filter((field) => /INT|DOUBLE|FLOAT|DECIMAL|REAL|NUMERIC/i.test(field.type));
  const namedField = relation.schema.find((field) => new RegExp(`\\b${field.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(request));
  const field = namedField || numericFields[0];
  const comparison = request.match(/(?:above|over|greater than|>=?)\s*(-?\d+(?:\.\d+)?)/i)
    || request.match(/(?:below|under|less than|<=?)\s*(-?\d+(?:\.\d+)?)/i);
  let where = "";
  if (comparison && field) {
    const lower = /above|over|greater|>/.test(comparison[0].toLowerCase());
    where = ` WHERE ${quoteIdentifier(field.name)} ${lower ? ">" : "<"} ${Number(comparison[1])}`;
  }
  const sql = `SELECT * FROM ${quoteIdentifier(relation.name)}${where} LIMIT ${Math.min(1000, Math.max(1, Number(limit) || 100))}`;
  return {
    relation: relation.name,
    sql: validateReadOnlySQL(sql),
    explanation: where ? `Filter ${relation.title} using ${field.name}.` : `Preview records from ${relation.title}.`,
    filter: where && relation.source.layerId ? { layerId: relation.source.layerId, field: field.name, operator: where.includes(" > ") ? ">" : "<", value: Number(comparison[1]) } : null,
  };
}

