import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ApplicationState } from '../js/application-state.js';
import { EventBus } from '../js/events.js';
import { buildManifest, createPublicStateApi } from '../js/application-manifest.js';

function fixture() {
  const state = new ApplicationState();
  const layers = [{ uid: 'layer-1', type: 'feature', visible: true, opacity: 0.5, queryable: true, filterable: true, fields: [{ name: 'private-field' }] }];
  const runtime = { state, snapshot: () => ({ preset: 'standard', mode: 'edit', layout: { kind: 'workspace' }, panels: [] }) };
  const mapController = { isReady: () => true, getLayers: () => layers, getLayerConfig: () => ({ sourceType: 'feature', url: 'https://secret.test/?token=secret', definitionExpression: 'private = 123', rendererSpec: { value: 'secret' } }), getEngineId: () => 'maplibre', getBasemapId: () => 'osm' };
  const events = new EventBus();
  return { state, layers, events, api: createPublicStateApi({ runtime, mapController, documentRef: { documentElement: { dataset: { gismapState: 'ready' } } }, events }) };
}
test('manifest derives from registries and static output remains generated', async () => {
  assert.deepEqual(JSON.parse(await readFile(new URL('../api/manifest.json', import.meta.url))), buildManifest());
  assert.ok(buildManifest().actions.some((a) => a.id === 'layer.add' && a.inputSchema));
  assert.ok(buildManifest().engines.some((e) => e.id === 'maplibre'));
});
test('public snapshots and diffs omit private data', async () => {
  const f = fixture();
  const changes = [];
  f.api.subscribe((event) => changes.push(event));
  f.state.dispatch('selection:set', { layerId: 'layer-1', objectIds: [42], features: [{ attributes: { password: 'secret' } }] });
  await Promise.resolve();
  assert.equal(changes.length, 1);
  assert.equal(changes[0].revision, 1);
  assert.equal(changes[0].previousRevision, 0);
  const json = JSON.stringify([f.api.snapshot(), changes]);
  for (const secret of ['secret', 'private-field', 'private = 123', 'password', 'https://']) assert.ok(!json.includes(secret));
  assert.equal(f.api.snapshot().layers[0].filters.active, true);
});
test('validated layer activation and undo reuse the application state', () => {
  const f = fixture();
  assert.throws(() => f.api.mutate('layer.activate', { layerId: 'unknown' }));
  assert.throws(() => f.api.mutate('layer.activate', { layerId: 'layer-1', extra: true }));
  f.api.mutate('layer.activate', { layerId: 'layer-1' });
  assert.equal(f.state.value.activeLayerId, 'layer-1');
  assert.equal(f.api.undo(), true);
  assert.equal(f.state.value.activeLayerId, null);
});
test('layer changes are observed and unsubscription works', async () => {
  const f = fixture(); let calls = 0;
  const subscription = f.api.subscribe(() => calls++);
  f.layers[0].visible = false; f.events.publish('layer:changed'); await Promise.resolve();
  assert.equal(calls, 1);
  subscription.remove(); f.layers[0].visible = true; f.events.publish('layer:changed'); await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(f.api.snapshot().revision, 2);
});
