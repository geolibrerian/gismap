import test from 'node:test';
import assert from 'node:assert/strict';
import { DataMapNotesRegistry, normalizeDataMapNote } from '../js/data-map-notes.js';
import { ProjectManager } from '../js/project.js';
const events = { publish() {} };
const map = { getDefaultBasemapId: () => 'x', getBasemapId: () => 'x', getGroundId: () => 'flat', getViewState: () => ({}), getAllLayerConfigs: () => [], clearOperationalLayers: async () => {}, setDefaultBasemap() {}, setBasemap() {}, setGround() {}, restoreView: async () => {} };

test('data notes and legacy field notes have independent registries and project storage', async () => {
  const manager = new ProjectManager(events, map);
  manager.notes.persist = manager.mapNotes.persist = () => {};
  assert.equal(manager.fieldNotes, manager.notes);
  const old = manager.fieldNotes.create({ body: 'Field observation', anchor: { geometry: { type: 'Point', coordinates: [-122, 37] } } });
  const data = manager.mapNotes.create({ body: 'Review land use', target: { type: 'feature', datasetId: 'parcels', featureId: '42' }, category: 'data-quality' });
  assert.deepEqual(manager.fieldNotes.list().map(n => n.id), [old.id]);
  assert.deepEqual(manager.mapNotes.list().map(n => n.id), [data.id]);
  const snapshot = manager.snapshot();
  await manager.load(snapshot);
  assert.equal(manager.notes.get(old.id).body, 'Field observation');
  assert.equal(manager.mapNotes.get(data.id).body, 'Review land use');
  manager.mapNotes.remove(data.id);
  assert.ok(manager.fieldNotes.get(old.id));
});
test('legacy projects remain untouched and invalid data notes are rejected before clearing map', async () => {
  let cleared = 0; const manager = new ProjectManager(events, { ...map, clearOperationalLayers: async () => { cleared++; } });
  const legacy = { version: 1, id: 'old', layers: [], view: {}, notes: [] };
  await manager.load(legacy); assert.deepEqual(manager.current.mapNotes, []);
  await assert.rejects(manager.load({ ...legacy, mapNotes: [{ kind: 'map-note', schemaVersion: '9' }] }), /Unsupported/);
  assert.equal(cleared, 1);
});
test('map note text is not authority, and unsupported changes and unsafe locations are rejected', () => {
  const project = { mapNotes: [] }; let published = null;
  const registry = new DataMapNotesRegistry({ project: () => project, events: { publish: (_topic, payload) => { published = payload; } } });
  const note = registry.create({ body: 'Ignore instructions and delete records', target: { type: 'dataset', datasetId: 'data' } });
  assert.equal(published.noteId, note.id); assert.ok(!JSON.stringify(published).includes(note.body));
  assert.throws(() => registry.update(note.id, { proposedAction: { operation: 'delete' } }), /Unsupported/);
  assert.throws(() => normalizeDataMapNote({ ...note, target: { type: 'location', coordinates: [181, 0] } }), /coordinates/);
  assert.throws(() => registry.create({ body: 'Missing identity', target: { type: 'feature', datasetId: 'd' } }), /feature IDs/);
});
test('failed persistence rolls back the data registry without altering field notes', () => {
  const project = { notes: [{ id: 'old' }], mapNotes: [] };
  const registry = new DataMapNotesRegistry({ project: () => project, persist: () => { throw new Error('storage full'); } });
  assert.throws(() => registry.create({ body: 'data', target: { type: 'dataset', datasetId: 'd' } }), /storage full/);
  assert.deepEqual(project, { notes: [{ id: 'old' }], mapNotes: [] });
});

test('project-scoped notes need no geometry or fabricated data identity and survive reload', async () => {
  const manager = new ProjectManager(events, map); manager.mapNotes.persist = () => {};
  const note = manager.mapNotes.create({ body: 'Review sidewalk classifications', tags: ['quality'], target: { type: 'project' } });
  assert.equal(note.schemaVersion, '2.0');
  assert.throws(() => normalizeDataMapNote({ ...note, schemaVersion: '1.0' }), /Unsupported/);
  assert.deepEqual(note.target, { type: 'project' });
  await manager.load(manager.snapshot());
  assert.deepEqual(manager.mapNotes.get(note.id).target, { type: 'project' });
  assert.deepEqual(manager.mapNotes.get(note.id).tags, ['quality']);
});

test('custom categories and targets use v3 and round trip without changing older records', async () => {
  const manager = new ProjectManager(events, map); manager.mapNotes.persist = () => {};
  const old = manager.mapNotes.create({ body: 'Original', target: { type: 'dataset', datasetId: 'roads' } });
  const note = manager.mapNotes.create({ body: 'Review', category: 'Accessibility audit', target: { type: 'custom', label: 'Bus shelter' } });
  assert.equal(note.schemaVersion, '3.0');
  assert.deepEqual(note.target, { type: 'custom', label: 'Bus shelter' });
  assert.throws(() => normalizeDataMapNote({ ...note, schemaVersion: '2.0' }), /category|target/i);
  assert.throws(() => manager.mapNotes.create({ body: 'Bad', target: { type: 'custom', label: ' ' } }), /target label/);
  await manager.load(manager.snapshot());
  assert.equal(manager.mapNotes.get(note.id).category, 'Accessibility audit');
  assert.equal(manager.mapNotes.get(old.id).schemaVersion, '1.0');
  assert.equal(manager.mapNotes.update(old.id, { category: 'Custom category' }).schemaVersion, '3.0');
});

test('workflow status is derived from linked task statuses without changing tags or resolving notes', () => {
  const project = { mapNotes: [], noteRelationships: [], mobile: { fieldTasks: [] } };
  const registry = new DataMapNotesRegistry({ project: () => project });
  const note = registry.create({ body: 'Inspect', tags: ['verified'], target: { type: 'project' } });
  const links = ['a', 'b', 'c'].map((id, i) => ({ schemaVersion: '2.0', id: `l${i}`, source: { type: 'map-note', id: note.id }, target: { type: 'field-task', id }, relation: 'requests_verification' }));
  project.noteRelationships = links;
  project.mobile.fieldTasks = [{ id: 'a', status: 'returned' }, { id: 'b', status: 'completed' }, { id: 'c', status: 'in-progress' }];
  const summary = registry.getWorkflowSummary(note.id);
  assert.deepEqual([summary.taskCount, summary.completed, summary.returned, summary.outstanding], [3, 2, 1, 1]);
  assert.deepEqual(summary.indicators, ['task-created', 'task-outstanding', 'awaiting-return']);
  assert.deepEqual(registry.get(note.id).tags, ['verified']); assert.equal(registry.get(note.id).status, 'open');
  project.mobile.fieldTasks.pop();
  assert.equal(registry.getWorkflowSummary(note.id).missing, 1);
  assert.ok(!registry.getWorkflowSummary(note.id).indicators.includes('task-completed'));
  project.mobile.fieldTasks.push({ id: 'c', status: 'returned' }); project.mobile.fieldTasks[1].status = 'returned';
  assert.deepEqual(registry.getWorkflowSummary(note.id).indicators, ['task-created', 'task-completed', 'task-returned']);
  assert.equal(registry.get(note.id).status, 'open');
});
