import { normalizeDataCatalog, quoteIdentifier, validateReadOnlySQL } from "./data-catalog.js?v=0.16.0";

// The npm package version is independent of the DuckDB engine version it embeds.
const DUCKDB_MODULE = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export class DuckDBBrowserClient {
  constructor() { this.db = null; this.connection = null; this.worker = null; this.loadedRelations = new Set(); }

  async initialize() {
    if (this.connection) return this;
    const duckdb = await import(DUCKDB_MODULE);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: "text/javascript" }));
    this.worker = new Worker(workerUrl);
    this.db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), this.worker);
    await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);
    await this.db.open({ path: ":memory:", query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true } });
    this.connection = await this.db.connect();
    return this;
  }

  async loadCatalog(catalog, resolveLayerRows) {
    await this.initialize();
    const normalized = normalizeDataCatalog(catalog);
    for (const relation of normalized.relations) {
      const name = quoteIdentifier(relation.name);
      if (this.loadedRelations.has(relation.name)) await this.connection.query(`DROP VIEW IF EXISTS ${name}`);
      if (relation.source.layerId) {
        const rows = await resolveLayerRows(relation.source.layerId);
        const fileName = `${relation.name}.json`;
        await this.db.registerFileText(fileName, JSON.stringify(rows));
        await this.connection.query(`CREATE VIEW ${name} AS SELECT * FROM read_json_auto(${sqlLiteral(fileName)})`);
      } else if (relation.source.url && relation.source.format === "parquet") {
        await this.connection.query(`CREATE VIEW ${name} AS SELECT * FROM read_parquet(${sqlLiteral(relation.source.url)})`);
      } else if (relation.source.url && ["json", "geojson"].includes(relation.source.format)) {
        await this.connection.query(`CREATE VIEW ${name} AS SELECT * FROM read_json_auto(${sqlLiteral(relation.source.url)})`);
      } else if (relation.source.url && relation.source.format === "csv") {
        await this.connection.query(`CREATE VIEW ${name} AS SELECT * FROM read_csv_auto(${sqlLiteral(relation.source.url)})`);
      }
      this.loadedRelations.add(relation.name);
    }
    return normalized;
  }

  async query(sql) {
    await this.initialize();
    const result = await this.connection.query(validateReadOnlySQL(sql));
    return result.toArray().map((row) => Object.fromEntries(Object.entries(row.toJSON?.() || row)));
  }

  async close() {
    await this.connection?.close?.();
    await this.db?.terminate?.();
    this.worker?.terminate?.();
    this.connection = null; this.db = null; this.worker = null; this.loadedRelations.clear();
  }
}
