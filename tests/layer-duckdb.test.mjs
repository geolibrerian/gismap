import test from 'node:test';
import assert from 'node:assert/strict';
import { registerLayerSnapshot } from '../js/layer-duckdb.js';

function fixture(features, options = {}) {
  const layer = { uid: 'one', title: 'Places', queryable: true, countable: true, paginated: true, objectIdField: 'id', fields: [{ name: 'id' }], ...options };
  let calls = 0;
  const map = { getLayer: () => layer, getLayerConfig: () => ({ local: true }), queryFeatureCount: async () => features.length, queryFeatures: async (_id, { start, num }) => { calls++; return { features: features.slice(start, start + num), exceededTransferLimit: start + num < features.length }; } };
  const client = { loadedRelations: new Set(), files: new Map(), async importLocalFile(file, name) { this.files.set(name, JSON.parse(await file.text())); this.loadedRelations.add(name); }, async registerEmptyLayer(name) { this.files.set(name, []); this.loadedRelations.add(name); }, async removeRelation(name) { this.loadedRelations.delete(name); } };
  return { map, layer, runtime: { duckdb: client }, client, calls: () => calls };
}
const feature = (id) => ({ attributes: { id, name: `feature ${id}` }, geometry: { type: 'Point', coordinates: [-74, 40] } });
test('registers paged local features once with IDs and geometry', async () => {
  const f = fixture([feature(1), feature(2), feature(3)]);
  const [a, b] = await Promise.all([registerLayerSnapshot(f.runtime, f.map, 'one', { pageSize: 2 }), registerLayerSnapshot(f.runtime, f.map, 'one', { pageSize: 2 })]);
  assert.equal(a, b); assert.equal(a.completeness, 'complete'); assert.equal(f.calls(), 2);
  assert.equal(f.client.files.get(a.relation)[0].id, 1);
  assert.deepEqual(JSON.parse(f.client.files.get(a.relation)[0].__gismap_geometry), feature(1).geometry);
  assert.equal(await registerLayerSnapshot(f.runtime, f.map, 'one'), a);
});
test('reports bounded and non-paginated snapshots as partial', async () => {
  const f = fixture([feature(1), feature(2), feature(3)]);
  const a = await registerLayerSnapshot(f.runtime, f.map, 'one', { maxRows: 2, pageSize: 1 });
  assert.equal(a.count, 2); assert.equal(a.completeness, 'partial');
  const g = fixture([feature(1), feature(2)], { paginated: false });
  assert.equal((await registerLayerSnapshot(g.runtime, g.map, 'one', { pageSize: 1 })).completeness, 'partial');
});
test('handles empty and null geometries, and rejects reserved fields', async () => {
  const empty = fixture([]); assert.equal((await registerLayerSnapshot(empty.runtime, empty.map, 'one')).count, 0);
  const noGeom = fixture([{ attributes: { id: 1 }, geometry: null }]);
  const result = await registerLayerSnapshot(noGeom.runtime, noGeom.map, 'one'); assert.equal(noGeom.client.files.get(result.relation)[0].__gismap_geometry, null);
  const bad = fixture([{ attributes: { id: 1, __gismap_geometry: 'x' }, geometry: null }]);
  await assert.rejects(registerLayerSnapshot(bad.runtime, bad.map, 'one'), /reserved field/);
});
test('avoids duplicate relation names for simultaneous layers', async () => {
  const a = fixture([feature(1)]); const b = fixture([feature(2)]); b.runtime = a.runtime;
  const [one, two] = await Promise.all([registerLayerSnapshot(a.runtime, a.map, 'one'), registerLayerSnapshot(a.runtime, b.map, 'two')]);
  assert.notEqual(one.relation, two.relation); assert.equal(a.client.loadedRelations.size, 2);
});
test('marks byte-limited snapshots partial', async () => {
  const f = fixture([feature(1), feature(2)]);
  const result = await registerLayerSnapshot(f.runtime, f.map, 'one', { maxBytes: 130 });
  assert.equal(result.count, 1); assert.equal(result.completeness, 'partial');
});
test('does not leave a relation when the layer is removed during import', async () => {
  const f = fixture([feature(1)]); let present = true;
  f.map.getLayer = () => present ? f.layer : null;
  f.client.importLocalFile = async (_file, name) => { f.client.loadedRelations.add(name); present = false; };
  await assert.rejects(registerLayerSnapshot(f.runtime, f.map, 'one'), /removed/);
  assert.equal(f.client.loadedRelations.size, 0);
});
