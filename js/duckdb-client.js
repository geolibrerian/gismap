import { normalizeDataCatalog, quoteIdentifier, validateReadOnlySQL } from "./data-catalog.js?v=0.18.2";

// The npm package version is independent of the DuckDB engine version it embeds.
const DUCKDB_MODULE = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export class DuckDBBrowserClient {
  constructor() { this.db = null; this.connection = null; this.worker = null; this.loadedRelations = new Set(); this.registeredFiles = new Set(); this.relationFiles = new Map(); this.initializing = null; }

  async initialize() {
    if (this.connection) return this;
    if (this.initializing) return this.initializing;
    this.initializing = this.#start();
    try { return await this.initializing; } finally { this.initializing = null; }
  }

  async #start() {
    const duckdb = await import(DUCKDB_MODULE);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(new Blob([`importScripts(${JSON.stringify(bundle.mainWorker)});`], { type: "text/javascript" }));
    try {
      this.worker = new Worker(workerUrl);
      this.db = new duckdb.AsyncDuckDB(new duckdb.ConsoleLogger(), this.worker);
      await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);
      await this.db.open({ path: ":memory:", query: { castBigIntToDouble: true, castDecimalToDouble: true, castTimestampToDate: true } });
      this.connection = await this.db.connect();
      return this;
    } catch (error) {
      await this.close();
      throw new Error(`DuckDB could not start in this browser: ${error.message}`, { cause: error });
    } finally { URL.revokeObjectURL(workerUrl); }
  }

  /** Import is explicit and local; no user-provided SQL is executed here. */
  async importLocalFile(file, name = "local_data") {
    const identifier = quoteIdentifier(name);
    const extension = String(file?.name || "").split(".").pop().toLowerCase();
    const readers = { csv: "read_csv_auto", json: "read_json_auto", geojson: "read_json_auto", parquet: "read_parquet", geoparquet: "read_parquet" };
    if (!readers[extension]) throw new Error("Choose a CSV, JSON, GeoJSON, Parquet, or GeoParquet file.");
    if (file.size > 200 * 1024 * 1024) throw new Error("This file exceeds the 200 MB browser import limit. Use a smaller file or a remote tile service.");
    await this.initialize();
    const filename = `gismap-${crypto.randomUUID()}.${extension}`;
    await this.db.registerFileBuffer(filename, new Uint8Array(await file.arrayBuffer()));
    try {
      await this.connection.query(`CREATE OR REPLACE TEMP VIEW ${identifier} AS SELECT * FROM ${readers[extension]}(${sqlLiteral(filename)})`);
      const previous = this.relationFiles.get(name);
      if (previous) { await this.db.dropFile?.(previous); this.registeredFiles.delete(previous); }
      this.registeredFiles.add(filename);
      this.relationFiles.set(name, filename);
      this.loadedRelations.add(name);
      return name;
    } catch (error) {
      await this.db.dropFile?.(filename);
      throw new Error(`Could not import the file: ${error.message}`, { cause: error });
    }
  }

  async inspectRelation(name, limit = 50) {
    if (!this.loadedRelations.has(name)) throw new Error("This table is not loaded in the current browser session.");
    const identifier = quoteIdentifier(name);
    const size = Math.max(1, Math.min(200, Math.floor(Number(limit) || 50)));
    const toRows = (result) => result.toArray().map((row) => Object.fromEntries(Object.entries(row.toJSON?.() || row)));
    const [schema, rows] = await Promise.all([
      this.connection.query(`DESCRIBE SELECT * FROM ${identifier}`),
      this.connection.query(`SELECT * FROM ${identifier} LIMIT ${size}`),
    ]);
    return { schema: toRows(schema), rows: toRows(rows) };
  }

  async checkSpatial() {
    await this.initialize();
    try {
      await this.connection.query("INSTALL spatial");
      await this.connection.query("LOAD spatial");
      await this.connection.query("SELECT ST_AsText(ST_Point(0, 0))");
      return true;
    } catch (error) { throw new Error(`DuckDB spatial extension is unavailable in this browser: ${error.message}`, { cause: error }); }
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
    for (const file of this.registeredFiles) await this.db?.dropFile?.(file).catch(() => {});
    await this.db?.terminate?.();
    this.worker?.terminate?.();
    this.connection = null; this.db = null; this.worker = null; this.loadedRelations.clear(); this.registeredFiles.clear(); this.relationFiles.clear();
  }
}
