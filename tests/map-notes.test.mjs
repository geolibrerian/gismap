import test from 'node:test';
import assert from 'node:assert/strict';
import { MapNotesRegistry, normalizeNote, normalizeNotes } from '../js/map-notes.js';
import { ProjectManager } from '../js/project.js';

const point = { type: 'point', crs: 'EPSG:4326', geometry: { type: 'Point', coordinates: [-122.27, 37.8] } };
const fixture = { schemaVersion: '1.0', id: 'note-a', type: 'issue', title: 'Address', body: 'Incorrect', createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', anchor: point, relationships: [{ type: 'references_feature', targetType: 'feature', datasetId: 'buildings', featureId: '42' }] };
const events = { publish() {} };
test('notes validate and keep feature relationships independently of source layers', () => {
  const note = normalizeNote(fixture);
  assert.deepEqual(note.anchor.geometry.coordinates, [-122.27, 37.8]);
  assert.equal(note.relationships[0].featureId, '42');
  assert.equal(note.review.status, 'unreviewed'); assert.equal(note.status, 'open');
  assert.deepEqual(normalizeNote(JSON.parse(JSON.stringify(note))), note);
});
test('reject unsafe, invalid, and unsupported data instead of silently importing it', () => {
  assert.throws(() => normalizeNote({ ...fixture, anchor: { geometry: { type: 'Point', coordinates: [181, 0] } } }));
  assert.throws(() => normalizeNote({ ...fixture, schemaVersion: '2.0' }));
  assert.throws(() => normalizeNote({ ...fixture, attachments: [{ url: 'https://example.test/a' }] }));
  assert.throws(() => normalizeNotes([fixture, fixture]), /Duplicate/);
  assert.throws(() => normalizeNote({ ...fixture, relationships: [{ type: 'references_feature', targetType: 'feature', featureId: '1' }] }));
});
test('registry owns project records, filters and emits only identifiers and counts', () => {
  const project = { id: 'p1', notes: [] }; const emitted = []; let saves = 0;
  const registry = new MapNotesRegistry({ project: () => project, events: { publish: (name, data) => emitted.push({ name, data }) }, persist: () => { saves++; } });
  const note = registry.create({ title: '<script>', body: 'private', anchor: point, relationships: fixture.relationships });
  assert.equal(registry.list({ datasetId: 'buildings' }).length, 1);
  assert.equal(registry.get(note.id).relationships.at(-1).targetId, 'p1');
  registry.update(note.id, { status: 'resolved' }); assert.equal(registry.get(note.id).review.status, 'unreviewed');
  assert.ok(!JSON.stringify(emitted).includes('private')); assert.equal(saves, 2);
  const clone = JSON.parse(registry.exportJSON()); assert.deepEqual(clone.notes, registry.list());
  assert.throws(() => registry.import(clone.notes), /merge/); assert.equal(registry.list().length, 1);
  assert.equal(registry.remove(note.id), true); assert.equal(registry.remove(note.id), false);
});
test('project snapshot carries notes and old projects initialize with none', () => {
  const map = { getDefaultBasemapId: () => 'x', getBasemapId: () => 'x', getGroundId: () => 'flat', getViewState: () => ({}), getAllLayerConfigs: () => [] };
  const manager = new ProjectManager(events, map); assert.deepEqual(manager.current.notes, []);
  manager.notes.persist = () => {};
  const note = manager.notes.create({ body: 'Record', anchor: point });
  const snapshot = manager.snapshot(); assert.equal(snapshot.notes[0].id, note.id);
  snapshot.notes[0].body = 'different'; assert.equal(manager.notes.get(note.id).body, 'Record');
});
test('project load migrates old projects and rejects bad notes before touching the map', async () => {
  let cleared = 0;
  const map = { getDefaultBasemapId: () => 'x', clearOperationalLayers: async () => { cleared++; }, setDefaultBasemap() {}, setBasemap() {}, setGround() {}, restoreView: async () => {} };
  const manager = new ProjectManager(events, map);
  const oldProject = { version: 1, id: 'old', name: 'Old', layers: [], view: {} };
  await manager.load(oldProject); assert.deepEqual(manager.current.notes, []); assert.equal(cleared, 1);
  await assert.rejects(manager.load({ ...oldProject, notes: [{ ...fixture, schemaVersion: '9' }] }), /Unsupported/);
  assert.equal(cleared, 1); assert.equal(manager.current.id, 'old');
});
test('failed storage leaves the project unchanged and emits no success event', () => {
  const project = { id: 'p', notes: [] }; let emitted = 0;
  const registry = new MapNotesRegistry({ project: () => project, events: { publish() { emitted++; } }, persist: () => { throw new Error('storage full'); } });
  assert.throws(() => registry.create({ body: 'Unsaved', anchor: point }), /storage full/);
  assert.deepEqual(project.notes, []); assert.equal(emitted, 0);
});
test('the note panel uses the shared dialog without a nested form', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../js/map-notes-panel.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-action="tools-map-notes"/);
  assert.match(source, /data-note-save/); assert.doesNotMatch(source, /<form\b/);
  assert.match(source, /escape\(item\.body\)/); assert.match(source, /2 \* 1024 \* 1024/);
});

test('field observation location metadata round trips and validates', () => {
  const note = normalizeNote({ ...fixture, fieldSessionId: 'session-1', observedAt: fixture.createdAt, coordinateSource: 'gps', accuracyMeters: 12.5, revision: 1 });
  assert.equal(note.accuracyMeters, 12.5); assert.equal(note.coordinateSource, 'gps');
  assert.deepEqual(normalizeNote(JSON.parse(JSON.stringify(note))), note);
  assert.throws(() => normalizeNote({ ...note, accuracyMeters: -1 }), /accuracy/);
  assert.throws(() => normalizeNote({ ...note, coordinateSource: 'unknown' }), /coordinate source/);
});

test('field session commits locally before changing project; failed writes do not lose data', async () => {
  const { FieldSessionController } = await import('../js/field-session-store.js');
  let saved = null; let fail = true; const project = { id: 'p', notes: [] };
  const manager = { current: project, persistCurrentIfSaved() {} };
  const store = { async save(session) { if (fail) throw new Error('disk full'); saved = structuredClone(session); return saved; } };
  const controller = new FieldSessionController(manager, events, store);
  await assert.rejects(controller.mutate('create', { body: 'first', anchor: point, coordinateSource: 'gps', accuracyMeters: 4 }), /disk full/);
  assert.equal(project.notes.length, 0);
  fail = false;
  const note = await controller.mutate('create', { body: 'first', anchor: point, coordinateSource: 'gps', accuracyMeters: 4 });
  assert.equal(saved.notes.length, 1); assert.equal(note.fieldSessionId, saved.id); assert.equal(note.accuracyMeters, 4);
  await controller.mutate('update', note.id, { body: 'updated' }); assert.equal(project.notes[0].revision, 2);
  const other = { current: { id: 'new', notes: [] } }; const resumed = new FieldSessionController(other, events, store);
  await resumed.resume(saved); assert.equal(other.current.notes[0].body, 'updated');
  await assert.rejects(resumed.resume(saved), /empty project/);
});
