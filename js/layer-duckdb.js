import { graphicToGeoJSONFeature } from './export/export-core.js?v=0.18.2';
import { openDuckdbQueryWorkspace } from './duckdb-query-workspace.js?v=0.54.0-vector2';

// Snapshots are deliberately bounded: local layers may already occupy substantial memory.
const MAX_ROWS = 20000;
const MAX_BYTES = 32 * 1024 * 1024;
const PAGE_SIZE = 1000;
const GEOMETRY_FIELD = '__gismap_geometry';

/** Register one local layer in the application-wide session. Repeated opens reuse it. */
export async function registerLayerSnapshot(runtime, mapController, uid, limits = {}) {
  const client = runtime.duckdb;
  runtime.analysisLayers ||= new Map();
  runtime.analysisLayerPending ||= new Map();
  const existing = runtime.analysisLayers.get(uid);
  if (existing && client.loadedRelations.has(existing.relation)) return existing;
  if (runtime.analysisLayerPending.has(uid)) return runtime.analysisLayerPending.get(uid);
  const task = (async () => {
    const layer = mapController.getLayer(uid);
    const config = layer && mapController.getLayerConfig(layer);
    if (!layer?.queryable || !config?.local) throw new Error('Choose a local, queryable vector layer.');
    if (layer.fields?.some((field) => field.name === GEOMETRY_FIELD)) throw new Error(`The layer contains the reserved field ${GEOMETRY_FIELD}. Rename it before querying.`);
    const maxRows = limits.maxRows ?? MAX_ROWS;
    const maxBytes = limits.maxBytes ?? MAX_BYTES;
    const pageSize = limits.pageSize ?? PAGE_SIZE;
    const count = layer.countable ? await mapController.queryFeatureCount(uid, { where: '1=1' }, { layerDefaults: false }).catch(() => null) : null;
    const lines = []; const encoder = new TextEncoder(); let bytes = 2; let offset = 0; let capped = false; let exhausted = false;
    const seen = new Set();
    while (offset < maxRows) {
      const num = Math.min(pageSize, maxRows - offset);
      const params = { where: '1=1', outFields: ['*'], returnGeometry: true, outSpatialReference: { wkid: 4326 }, start: offset, num };
      if (layer.objectIdField) params.orderByFields = [layer.objectIdField];
      const result = await mapController.queryFeatures(uid, params, { layerDefaults: false });
      const features = result.features || [];
      if (!features.length) { exhausted = !result.exceededTransferLimit; break; }
      for (const feature of features) {
        const id = layer.objectIdField && feature.attributes?.[layer.objectIdField];
        if (id != null && seen.has(String(id))) { capped = true; break; }
        if (id != null) seen.add(String(id));
        const geojson = graphicToGeoJSONFeature(feature);
        if (Object.hasOwn(geojson.properties, GEOMETRY_FIELD)) throw new Error(`The layer contains the reserved field ${GEOMETRY_FIELD}. Rename it before querying.`);
        const row = { ...geojson.properties, [GEOMETRY_FIELD]: geojson.geometry ? JSON.stringify(geojson.geometry) : null };
        const line = JSON.stringify(row, (_key, value) => typeof value === 'bigint' ? String(value) : value);
        const size = encoder.encode(line).length + 1;
        if (bytes + size > maxBytes) { capped = true; break; }
        lines.push(line); bytes += size;
      }
      offset += features.length;
      if (capped) break;
      if (Number.isFinite(count) && offset >= count) { exhausted = true; break; }
      if (!result.exceededTransferLimit && features.length < num) { exhausted = true; break; }
      if (layer.paginated === false) { capped = true; break; }
    }
    if (!mapController.getLayer(uid)) throw new Error('The layer was removed while its snapshot was being prepared.');
    if (!lines.length && capped) throw new Error('A feature exceeds the browser analysis snapshot size limit.');
    let name = String(layer.title || 'layer').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 50) || 'layer';
    const base = name; let n = 2;
    // Include pending registrations to avoid two layers choosing the same name.
    runtime.analysisNames ||= new Set();
    while (client.loadedRelations.has(name) || runtime.analysisNames.has(name)) name = `${base}_${n++}`;
    runtime.analysisNames.add(name);
    try {
      if (lines.length) {
        const file = new File(['[', lines.join(','), ']'], `${name}.json`, { type: 'application/json' });
        await client.importLocalFile(file, name);
      } else {
        await client.registerEmptyLayer(name, layer.fields || []);
      }
      if (!mapController.getLayer(uid)) {
        await client.removeRelation(name);
        throw new Error('The layer was removed while its snapshot was being prepared.');
      }
      const completeness = Number.isFinite(count) ? (lines.length === count ? 'complete' : 'partial') : (capped || !exhausted ? 'partial' : 'unverified');
      const entry = { relation: name, count: lines.length, total: count, completeness };
      runtime.analysisLayers.set(uid, entry);
      client.relationProvenance ||= new Map();
      client.relationProvenance.set(name, `${lines.length.toLocaleString()} rows · ${completeness === "complete" ? "complete" : completeness === "partial" ? "partial; not the complete layer" : "completeness not verified"} local snapshot. Geometry is GeoJSON text in __gismap_geometry.`);
      return entry;
    } finally { runtime.analysisNames.delete(name); }
  })();
  runtime.analysisLayerPending.set(uid, task);
  try { return await task; } finally { runtime.analysisLayerPending.delete(uid); }
}

export async function openLayerInDuckdb(ui, uid) {
  const parquet = ui.applicationRuntime.geoParquetLayers?.get(uid);
  if (parquet && ui.applicationRuntime.duckdb.loadedRelations.has(parquet.relation)) {
    openDuckdbQueryWorkspace(ui, ui.applicationRuntime.duckdb, { selectedRelation: parquet.relation, message: `Querying the full GeoParquet source. The map ${parquet.truncated ? `shows only the first ${parquet.limit} features` : `shows ${parquet.count} features`}.` });
    return;
  }
  ui.toast('Preparing a local DuckDB snapshot…');
  const snapshot = await registerLayerSnapshot(ui.applicationRuntime, ui.mapController, uid);
  const scope = snapshot.completeness === 'complete' ? 'complete snapshot' : snapshot.completeness === 'partial' ? 'partial snapshot; not the complete layer' : 'snapshot; completeness not verified';
  openDuckdbQueryWorkspace(ui, ui.applicationRuntime.duckdb, { selectedRelation: snapshot.relation, message: `${snapshot.count.toLocaleString()} rows (${scope}). Snapshot reflects the layer when prepared; geometry is GeoJSON text in __gismap_geometry. Register another layer to query both with SQL.` });
}
