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
