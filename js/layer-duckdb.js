import { graphicToGeoJSONFeature } from './export/export-core.js?v=0.18.2';
import { openDuckdbQueryWorkspace } from './duckdb-query-workspace.js?v=0.54.0-vector1';

const MAX_ROWS = 5000;
export async function openLayerInDuckdb(ui, uid) {
  const layer = ui.mapController.getLayer(uid);
  const config = layer && ui.mapController.getLayerConfig(layer);
  const parquet = ui.applicationRuntime.geoParquetLayers?.get(uid);
  if (parquet && ui.applicationRuntime.duckdb.loadedRelations.has(parquet.relation)) {
    openDuckdbQueryWorkspace(ui, ui.applicationRuntime.duckdb, { selectedRelation: parquet.relation, message: `Querying the full GeoParquet source. The map ${parquet.truncated ? `shows only the first ${parquet.limit} features` : `shows ${parquet.count} features`}.` });
    return;
  }
  if (!layer?.queryable || !config?.local) throw new Error('Choose a local, queryable vector layer.');
  ui.toast('Preparing a local DuckDB snapshot…');
  const result = await ui.mapController.queryFeatures(uid, { where: '1=1', outFields: ['*'], returnGeometry: true, outSpatialReference: { wkid: 4326 }, num: MAX_ROWS + 1 }, { layerDefaults: false });
  if (!result.features.length) throw new Error('This layer has no records to query.');
  const count = layer.countable ? await ui.mapController.queryFeatureCount(uid, { where: '1=1' }, { layerDefaults: false }).catch(() => null) : null;
  const partial = result.exceededTransferLimit || result.features.length > MAX_ROWS || (Number.isFinite(count) && count > result.features.length);
  const completeness = partial ? ' (partial snapshot; not the complete layer)' : Number.isFinite(count) ? ' (complete snapshot)' : ' (completeness not verified)';
  const rows = result.features.slice(0, MAX_ROWS).map((feature) => {
    const geojson = graphicToGeoJSONFeature(feature);
    if (Object.hasOwn(geojson.properties, '__gismap_geometry')) throw new Error('The layer contains the reserved field __gismap_geometry. Rename it before querying.');
    return { ...geojson.properties, __gismap_geometry: geojson.geometry ? JSON.stringify(geojson.geometry) : null };
  });
  const client = ui.applicationRuntime.duckdb;
  let name = String(layer.title || 'layer').replace(/[^A-Za-z0-9_]+/g, '_').replace(/^([^A-Za-z_])/, '_$1').slice(0, 50) || 'layer';
  const base = name; let n = 2; while (client.loadedRelations.has(name)) name = `${base}_${n++}`;
  const file = new File([JSON.stringify(rows, (_key, value) => typeof value === 'bigint' ? String(value) : value)], `${name}.json`, { type: 'application/json' });
  await client.importLocalFile(file, name);
  openDuckdbQueryWorkspace(ui, client, { selectedRelation: name, message: `Snapshot ready: ${rows.length} rows${completeness}. Geometry is GeoJSON text in __gismap_geometry.` });
}
