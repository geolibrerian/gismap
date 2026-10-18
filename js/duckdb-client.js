import { normalizeDataCatalog, quoteIdentifier, validateReadOnlySQL } from "./data-catalog.js?v=0.18.2";

// The npm package version is independent of the DuckDB engine version it embeds.
const DUCKDB_MODULE = "https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.32.0/+esm";

function sqlLiteral(value) { return `'${String(value).replaceAll("'", "''")}'`; }

export class DuckDBBrowserClient {
  constructor() { this.db = null; this.connection = null; this.worker = null; this.loadedRelations = new Set(); this.registeredFiles = new Set(); this.relationFiles = new Map(); this.parquetSources = new Map(); this.initializing = null; }

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
      if (["parquet", "geoparquet"].includes(extension)) this.parquetSources.set(name, filename); else this.parquetSources.delete(name);
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

  /** Return a bounded snapshot of a WGS84 GeoParquet relation for map display. */
  async geoParquetFeatures(name, limit = 1000) {
    if (!this.loadedRelations.has(name) || !this.parquetSources.has(name)) throw new Error("Load a Parquet file before adding it to the map.");
    const source = this.parquetSources.get(name);
    const metadataRows = await this.connection.query(`SELECT decode(value) AS geo FROM parquet_kv_metadata(${sqlLiteral(source)}) WHERE decode(key) = 'geo'`);
    const metadataRow = metadataRows.toArray()[0];
    if (!metadataRow) throw new Error("This Parquet file has no GeoParquet geometry metadata; it can still be queried as a table.");
    let metadata;
    try { metadata = JSON.parse(metadataRow.toJSON?.().geo ?? metadataRow.geo); }
    catch { throw new Error("The GeoParquet geometry metadata is invalid."); }
    const column = metadata.primary_column;
    const geometryInfo = metadata.columns?.[column];
    if (typeof column !== "string" || !column || !geometryInfo || geometryInfo.encoding !== "WKB") throw new Error("Only GeoParquet with WKB primary geometry is supported for mapping.");
    const crs = geometryInfo.crs;
    if (crs === null || (crs !== undefined && !((crs.id?.authority === "EPSG" && Number(crs.id.code) === 4326) || (crs.id?.authority === "OGC" && String(crs.id.code).toUpperCase() === "CRS84")))) throw new Error("This GeoParquet CRS is unknown or not WGS84 (EPSG:4326 / CRS84). Reproject it before mapping.");
    await this.checkSpatial();
    const table = quoteIdentifier(name);
    const quotedColumn = `"${column.replaceAll('"', '""')}"`;
    const schemaResult = await this.connection.query(`DESCRIBE SELECT * FROM ${table}`);
    const schema = schemaResult.toArray().map((row) => row.toJSON?.() || row);
    const field = schema.find((item) => item.column_name === column);
    if (!field) throw new Error("The GeoParquet primary geometry column is missing.");
    const size = Math.max(1, Math.min(5000, Math.floor(Number(limit) || 1000)));
    const geometrySql = /^GEOMETRY(?:\b|$)/i.test(field.column_type) ? quotedColumn : `ST_GeomFromWKB(${quotedColumn})`;
    const result = await this.connection.query(`SELECT * EXCLUDE (${quotedColumn}), ST_AsGeoJSON(${geometrySql}) AS "__gismap_geometry" FROM ${table} LIMIT ${size + 1}`);
    const rows = result.toArray().map((row) => row.toJSON?.() || row);
    const features = rows.slice(0, size).map((row) => {
      const { __gismap_geometry: raw, ...properties } = row;
      let geometry = null;
      if (raw != null) {
        try { geometry = typeof raw === "string" ? JSON.parse(raw) : raw; } catch { throw new Error("A geometry could not be converted to GeoJSON."); }
        if (!geometry || typeof geometry.type !== "string" || (!Array.isArray(geometry.coordinates) && !(geometry.type === "GeometryCollection" && Array.isArray(geometry.geometries)))) throw new Error("The GeoParquet contains an unsupported geometry.");
      }
      return { type: "Feature", geometry, properties };
    });
    if (!features.some((feature) => feature.geometry)) throw new Error("No non-null geometry was found in the first rows of this dataset.");
    return { collection: { type: "FeatureCollection", features }, truncated: rows.length > size, limit: size };
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
      if (relation.source.url && relation.source.format === "parquet") this.parquetSources.set(relation.name, relation.source.url); else this.parquetSources.delete(relation.name);
      this.loadedRelations.add(relation.name);
    }
    return normalized;
  }

  async removeRelation(name) {
    if (!this.loadedRelations.has(name)) return;
    await this.connection.query(`DROP VIEW IF EXISTS ${quoteIdentifier(name)}`);
    const file = this.relationFiles.get(name);
    if (file) { await this.db.dropFile?.(file); this.registeredFiles.delete(file); this.relationFiles.delete(name); }
    this.parquetSources.delete(name);
    this.loadedRelations.delete(name);
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
    this.connection = null; this.db = null; this.worker = null; this.loadedRelations.clear(); this.registeredFiles.clear(); this.relationFiles.clear(); this.parquetSources.clear();
  }
}
