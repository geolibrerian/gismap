import test from 'node:test';
import assert from 'node:assert/strict';
import { MapController } from '../js/map-controller.js';
import { ProjectManager } from '../js/project.js';
import { validateMapSpec } from '../js/map-spec.js';

const url = 'https://data.source.coop/cholmes/nyc-taxi-zones/taxi_zones_4326.parquet';
test('remote GeoParquet survives map-spec validation', () => {
  const result = validateMapSpec({ version: 1, layers: [{ url, type: 'geoparquet' }] });
  assert.equal(result.valid, true);
  assert.equal(result.spec.layers[0].type, 'geoparquet');
});
test('facade describes the original source, not the generated blob', () => {
  const ctrl = new MapController({ subscribe() {} });
  ctrl.engine = { getLayerConfig: () => ({ uid: 'a', local: true, url: 'blob:fake', fileName: 'snapshot.geojson' }), getLocalAsset: () => null };
  ctrl.setGeoParquetSource('a', { url });
  assert.equal(ctrl.getLayerConfig('a').url, url);
  assert.equal(ctrl.getLayerConfig('a').local, false);
  assert.equal(ctrl.getLayerConfig('a').sourceType, 'geoparquet');
  const file = new File(['bytes'], 'original.parquet');
  ctrl.setGeoParquetSource('a', { file, projectPath: 'data/original.parquet' });
  assert.equal(ctrl.getLocalAsset('a'), file);
  assert.equal(ctrl.getLayerConfig('a').fileName, file.name);
});
test('project restore loads remote and packaged sources using the unified loader', async () => {
  const calls = [];
  const file = new File(['data'], 'original.parquet');
  const map = { clearOperationalLayers: async () => {}, setDefaultBasemap() {}, getDefaultBasemapId: () => 'x', setBasemap() {}, setGround() {}, setVisibility() {}, setOpacity() {}, restoreView: async () => {} };
  const manager = new ProjectManager({ publish() {} }, map);
  manager.geoParquetLoader = async (opts) => { calls.push(opts); return { layer: { uid: `layer${calls.length}` } }; };
  const project = { version: 1, layers: [{ sourceType: 'geoparquet', url, title: 'Remote' }, { sourceType: 'geoparquet', local: true, fileName: file.name, projectPath: 'data/original.parquet' }] };
  const loaded = await manager.load(project, new Map([['data/original.parquet', file]]));
  assert.deepEqual(loaded.missingFiles, []);
  assert.equal(calls[0].url, url);
  assert.equal(calls[1].file, file);
});
