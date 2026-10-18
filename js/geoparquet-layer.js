// A bounded rendering snapshot uses the existing layer importer; the original
// Parquet relation remains in the application's shared DuckDB session.
import { createAnalysisDataset, describeAnalysisDataset } from './analysis-dataset.js?v=0.54.0-analysis1';
import { resolveRemoteParquetUrl } from './data-connections.js?v=0.54.0-parquet1';

export const isParquetName = (name) => /\.(?:geo)?parquet$/i.test(String(name || '').split(/[?#]/)[0]);

export async function addGeoParquetLayer(ui, { file, url, title, projectPath } = {}) {
  if (!!file === !!url) throw new Error('Choose a local file or a remote Parquet URL.');
  const client = ui.applicationRuntime.duckdb;
  const name = `layer_${crypto.randomUUID().replaceAll('-', '')}`;
  let layer;
  let sourceUrl = null;
  try {
    // Loading spatial changes DuckDB's inferred Parquet geometry type. Load it
    // before creating the view so its schema cannot change underneath it.
    await client.checkSpatial();
    if (file) await client.importLocalFile(file, name);
    else {
      const { url: source } = resolveRemoteParquetUrl(url);
      sourceUrl = source;
      await client.loadCatalog({ relations: [{ name, source: { format: 'parquet', url: source } }] }, () => []);
    }
    let mapped;
    try { mapped = await client.geoParquetFeatures(name); }
    catch (error) {
      if (/no GeoParquet geometry metadata/i.test(error.message)) return { tableOnly: true, relation: name };
      throw error;
    }
    const { collection, truncated, limit, geometryMetadata, fields } = mapped;
    const label = String(title || file?.name || new URL(url).pathname.split('/').pop() || 'GeoParquet').replace(/(?:\.(?:geo)?parquet|\.geojson)$/i, '').replace(/ — first \d+ features$/, '');
    const suffix = truncated ? ` — first ${limit} features` : '';
    const snapshot = new File([JSON.stringify(collection, (_key, value) => typeof value === 'bigint' ? String(value) : value)], `${label}${suffix}.geojson`, { type: 'application/geo+json' });
    layer = await ui.mapController.addLocalFile(snapshot);
    ui.mapController.setGeoParquetSource?.(layer.uid, { file: file || null, url: sourceUrl, projectPath: file ? (projectPath || `data/${name}-${file.name}`) : null });
    ui.mapController.setTitle?.(layer.uid, `${label}${suffix}`);
    if (!ui.applicationRuntime.geoParquetLayers) ui.applicationRuntime.geoParquetLayers = new Map();
    const config = { sourceType: 'geoparquet', local: Boolean(file) };
    const descriptor = createAnalysisDataset({ layer: { uid: layer.uid, title: `${label}${suffix}`, fields: fields || [], objectIdField: null }, config, relation: name, geometry: { field: geometryMetadata?.field || null, encoding: geometryMetadata?.encoding || 'unknown', types: geometryMetadata?.types || [], crs: geometryMetadata?.crs || 'unknown', crsStatus: geometryMetadata?.crs ? 'known' : 'unknown' }, coverage: { scope: 'source', status: 'source-relation' }, freshness: { kind: 'source', preparedAt: new Date().toISOString() } });
    client.analysisDatasets ||= new Map(); client.analysisDatasets.set(name, descriptor);
    client.relationProvenance ||= new Map(); client.relationProvenance.set(name, `${describeAnalysisDataset(descriptor)} Map preview: ${collection.features.length}${truncated ? ` (first ${limit} only)` : ''}.`);
    ui.applicationRuntime.geoParquetLayers.set(layer.uid, { relation: name, truncated, count: collection.features.length, limit, descriptor });
    ui.events?.publish?.("layer:changed", { uid: layer.uid });
    return { layer, truncated, limit, count: collection.features.length };
  } catch (error) {
    if (!layer) await client.removeRelation(name).catch(() => {});
    throw error;
  }
}
