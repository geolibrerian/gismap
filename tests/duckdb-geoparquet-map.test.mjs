import test from 'node:test';
import assert from 'node:assert/strict';
import { DuckDBBrowserClient } from '../js/duckdb-client.js';

const result = (rows) => ({ toArray: () => rows });
function clientFor(metadata, rows = []) {
  const client = new DuckDBBrowserClient();
  client.loadedRelations.add('taxi');
  client.parquetSources.set('taxi', 'https://example.com/file.parquet');
  client.checkSpatial = async () => true;
  client.connection = { query: async (sql) => {
    if (sql.includes('parquet_kv_metadata')) return result(metadata ? [{ geo: JSON.stringify(metadata) }] : []);
    if (sql.startsWith('DESCRIBE')) return result([{ column_name: 'geometry', column_type: 'BLOB' }]);
    if (sql.startsWith('SELECT * EXCLUDE')) return result(rows);
    throw new Error(`Unexpected query: ${sql}`);
  } };
  return client;
}
const metadata = { primary_column: 'geometry', columns: { geometry: { encoding: 'WKB' } } };
test('maps bounded GeoParquet results and reports truncation', async () => {
  const point = JSON.stringify({ type: 'Point', coordinates: [-74, 40] });
  const client = clientFor(metadata, [{ id: 1, __gismap_geometry: point }, { id: 2, __gismap_geometry: point }]);
  const output = await client.geoParquetFeatures('taxi', 1);
  assert.equal(output.truncated, true);
  assert.deepEqual(output.collection.features[0], { type: 'Feature', properties: { id: 1 }, geometry: { type: 'Point', coordinates: [-74, 40] } });
});
test('rejects missing metadata and unknown or projected CRS', async () => {
  await assert.rejects(clientFor(null).geoParquetFeatures('taxi'), /no GeoParquet/);
  for (const crs of [null, { id: { authority: 'EPSG', code: 3857 } }]) {
    await assert.rejects(clientFor({ primary_column: 'geometry', columns: { geometry: { encoding: 'WKB', crs } } }).geoParquetFeatures('taxi'), /CRS/);
  }
});
test('returns source geometry metadata and source fields, not the map preview identity', async () => {
  const point = JSON.stringify({ type: 'Point', coordinates: [-74, 40] });
  const output = await clientFor({primary_column:'geometry',columns:{geometry:{encoding:'WKB',geometry_types:['Point']}}}, [{geometry:point,__gismap_geometry:point}]).geoParquetFeatures('taxi');
  assert.deepEqual(output.geometryMetadata, {field:'geometry',encoding:'WKB',types:['Point'],crs:'OGC:CRS84'});
  assert.equal(output.fields[0].name,'geometry');
});
test('reports a useful spatial-extension failure', async () => {
  const client = new DuckDBBrowserClient();
  client.connection = {query: async () => { throw new Error('extension fetch failed'); }};
  await assert.rejects(client.checkSpatial(), /DuckDB spatial extension is unavailable in this browser: extension fetch failed/);
});
