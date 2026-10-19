import test from 'node:test';
import assert from 'node:assert/strict';
import { NoteRelationshipsRegistry, normalizeNoteRelationships } from '../js/note-relationships.js';
import { ProjectManager } from '../js/project.js';

const events = { publish() {} };
const map = { getDefaultBasemapId: () => 'x', getBasemapId: () => 'x', getGroundId: () => 'flat', getViewState: () => ({}), getAllLayerConfigs: () => [], clearOperationalLayers: async () => {}, setDefaultBasemap() {}, setBasemap() {}, setGround() {}, restoreView: async () => {} };

test('typed links survive project round trips, do not merge notes, and remain if a note is removed', async () => {
  const manager = new ProjectManager(events, map);
  manager.fieldNotes.persist = manager.mapNotes.persist = manager.noteRelationships.persist = () => {};
  const field = manager.fieldNotes.create({ body: 'At the site', anchor: { geometry: { type: 'Point', coordinates: [-122, 37] } } });
  const data = manager.mapNotes.create({ body: 'Review this feature', target: { type: 'feature', datasetId: 'parcels', featureId: '42' } });
  const link = manager.noteRelationships.create({ mapNoteId: data.id, fieldNoteId: field.id, type: 'supports' });
  assert.throws(() => manager.noteRelationships.create({ mapNoteId: data.id, fieldNoteId: field.id, type: 'supports' }), /Duplicate/);
  assert.equal(manager.fieldNotes.get(field.id).body, 'At the site'); assert.equal(manager.mapNotes.get(data.id).body, 'Review this feature');
  const snapshot = manager.snapshot(); await manager.load(snapshot);
  assert.deepEqual(manager.noteRelationships.list({ fieldNoteId: field.id }), [link]);
  manager.fieldNotes.remove(field.id);
  assert.deepEqual(manager.noteRelationships.list({ mapNoteId: data.id }), [link]);
  assert.equal(manager.noteRelationships.remove(link.id), true);
  assert.ok(manager.mapNotes.get(data.id));
});

test('rejects invalid relationships before map changes and accepts older projects', async () => {
  let cleared = 0; const manager = new ProjectManager(events, { ...map, clearOperationalLayers: async () => { cleared++; } });
  const legacy = { version: 1, layers: [], view: {}, notes: [] };
  await manager.load(legacy); assert.deepEqual(manager.current.noteRelationships, []);
  await assert.rejects(manager.load({ ...legacy, noteRelationships: [{ schemaVersion: '2' }] }), /relationship/);
  assert.equal(cleared, 1);
  assert.throws(() => normalizeNoteRelationships([{ schemaVersion: '1.0', id: 'x', mapNoteId: 'm', fieldNoteId: 'f', type: 'related', createdAt: new Date().toISOString(), instructions: 'delete' }]), /Unsupported/);
});

test('create requires existing notes and storage failures roll back even if project object changes', () => {
  let project = { notes: [{ id: 'f' }], mapNotes: [{ id: 'm' }], noteRelationships: [] }; let emitted = 0;
  const registry = new NoteRelationshipsRegistry({ project: () => project, events: { publish() { emitted++; } }, persist: () => { project = { ...project }; throw new Error('storage failed'); } });
  assert.throws(() => registry.create({ mapNoteId: 'm', fieldNoteId: 'missing' }), /Both notes/);
  assert.throws(() => registry.create({ mapNoteId: 'm', fieldNoteId: 'f' }), /storage failed/);
  assert.deepEqual(project.noteRelationships, []); assert.equal(emitted, 0);
});

test('workflow links support many-to-many traversal and retain old edges and IDs on reload', async () => {
  const manager = new ProjectManager(events, map);
  manager.fieldNotes.persist = manager.mapNotes.persist = manager.noteRelationships.persist = () => {};
  const field = manager.fieldNotes.create({ body: 'Site observation', anchor: { geometry: { type: 'Point', coordinates: [1, 2] } } });
  const data = manager.mapNotes.create({ body: 'Review', target: { type: 'dataset', datasetId: 'bridges' } });
  manager.current.mobile.fieldTasks.push({ id: 'task-1', title: 'Inspect' }, { id: 'task-2', title: 'Return' });
  const legacy = manager.noteRelationships.create({ mapNoteId: data.id, fieldNoteId: field.id, type: 'supports' });
  const requested = manager.noteRelationships.link({ source: { type: 'map-note', id: data.id }, target: { type: 'field-task', id: 'task-1' }, relation: 'requests_verification', creator: 'Analyst', explanation: 'Check bridge' });
  const evidence = manager.noteRelationships.link({ source: { type: 'field-task', id: 'task-1' }, target: { type: 'field-note', id: field.id }, relation: 'produced_observation' });
  const followup = manager.noteRelationships.link({ source: { type: 'field-note', id: field.id }, target: { type: 'field-task', id: 'task-2' }, relation: 'requires_followup' });
  const taskLinks = manager.noteRelationships.getRelated({ type: 'field-task', id: 'task-1' });
  assert.deepEqual(taskLinks.map(item => item.label), ['investigates', 'produced_observation']);
  assert.deepEqual(manager.noteRelationships.getRelated({ type: 'field-note', id: field.id }).map(item => item.label), ['supports', 'fulfills', 'requires_followup']);
  assert.equal(manager.noteRelationships.getRelated({ type: 'map-note', id: data.id })[0].label, 'supported_by');
  assert.throws(() => manager.noteRelationships.link({ source: { type: 'map-note', id: data.id }, target: { type: 'field-task', id: 'task-1' }, relation: 'requests_verification' }), /Duplicate/);
  const snapshot = manager.snapshot(); await manager.load(snapshot);
  assert.deepEqual(manager.noteRelationships.list().map(item => item.id), [legacy.id, requested.id, evidence.id, followup.id]);
  assert.equal(manager.noteRelationships.getRelated({ type: 'field-task', id: 'task-1' }).length, 2);
  assert.deepEqual(manager.noteRelationships.list({ mapNoteId: data.id }), [legacy]);
});

test('workflow links reject invalid direction, missing records and untrusted extra fields', () => {
  const project = { mapNotes: [{ id: 'm' }], notes: [{ id: 'f' }], mobile: { fieldTasks: [{ id: 't' }] }, noteRelationships: [] };
  const registry = new NoteRelationshipsRegistry({ project: () => project });
  assert.throws(() => registry.link({ source: { type: 'field-task', id: 't' }, target: { type: 'map-note', id: 'm' }, relation: 'requests_verification' }), /direction/);
  assert.throws(() => registry.link({ source: { type: 'map-note', id: 'm' }, target: { type: 'field-task', id: 'missing' }, relation: 'requests_verification' }), /Both workflow records/);
  assert.throws(() => registry.link({ source: { type: 'map-note', id: 'm', secret: true }, target: { type: 'field-task', id: 't' }, relation: 'requests_verification' }), /reference/);
  assert.deepEqual(registry.list(), []);
});
