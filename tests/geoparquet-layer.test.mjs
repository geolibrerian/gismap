import test from 'node:test';
import assert from 'node:assert/strict';
import { addGeoParquetLayer, isParquetName } from '../js/geoparquet-layer.js';

test('recognizes local and remote Parquet names', () => {
  assert.equal(isParquetName('file.GeoParquet'), true);
  assert.equal(isParquetName('https://example.com/data.parquet?foo=bar'), true);
  assert.equal(isParquetName('data.geojson'), false);
});
function fixture({ nonspatial = false } = {}) {
  const calls = [];
  const duckdb = {
    checkSpatial: async () => calls.push('spatial'),
    loadCatalog: async (catalog) => calls.push(catalog),
    geoParquetFeatures: async () => { if (nonspatial) throw new Error('This Parquet file has no GeoParquet geometry metadata; it can still be queried as a table.'); return { collection: { type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [1, 2] }, properties: {} }] }, truncated: true, limit: 1000 }; },
    removeRelation: async () => calls.push('remove'),
  };
  const ui = { applicationRuntime: { duckdb }, mapController: { addLocalFile: async (file) => { calls.push(file.name); return { uid: 'map-layer' }; } } };
  return { ui, calls };
}
test('creates a normal bounded layer and keeps its full-source relation', async () => {
  const { ui, calls } = fixture();
  const result = await addGeoParquetLayer(ui, { url: 'https://source.coop/a/b/file.parquet' });
  assert.equal(calls[0], 'spatial');
  assert.equal(calls[1].relations[0].source.url, 'https://data.source.coop/a/b/file.parquet');
  assert.match(calls[2], /first 1000 features/);
  assert.equal(result.truncated, true);
  assert.match(ui.applicationRuntime.geoParquetLayers.get('map-layer').relation, /^layer_[0-9a-f]+$/);
});
test('keeps ordinary Parquet available as a table instead of inventing geometry', async () => {
  const { ui, calls } = fixture({ nonspatial: true });
  const result = await addGeoParquetLayer(ui, { url: 'https://example.com/table.parquet' });
  assert.equal(result.tableOnly, true);
  assert.equal(calls.includes('remove'), false);
});
