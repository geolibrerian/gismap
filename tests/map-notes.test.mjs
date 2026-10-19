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
test('the note mode uses a workspace pane without a nested form', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../js/map-notes-panel.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /data-action="mode-map-notes"/); assert.doesNotMatch(html, /data-action="tools-map-notes"/); assert.match(source, /openMapNotesWorkspace/);
  assert.match(source, /data-note-save/); assert.doesNotMatch(source, /<form\b/);
  assert.match(source, /escape\(item\.body\)/); assert.match(source, /32 \* 1024 \* 1024/);
  assert.match(source, /<textarea data-session-description/);
  assert.match(source, /ui\.mobileMedia\.matches \? `<button type="button" data-note-gps/);
  assert.match(source, /data-note-pdf/);
  const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /map-notes-authoring/);
  assert.match(ui, /setMapNoteMarkers\(points\)/);
  assert.match(ui, /attach !== this\.mapNotesAttachFeature/);
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
  await resumed.resume(saved); assert.equal(other.current.notes.length, 1);
  other.current.notes = [normalizeNote({ ...fixture, fieldSessionId: 'another-session' })];
  await assert.rejects(resumed.resume(saved), /empty project/);
});

test('resuming merges compatible project notes safely and rejects divergent revisions', async () => {
  const { FieldSessionController, newFieldSession } = await import('../js/field-session-store.js');
  const session = { ...newFieldSession({ id: 'p', notes: [] }), revision: 1 };
  const first = normalizeNote({ ...fixture, id: 'first', fieldSessionId: session.id });
  const second = normalizeNote({ ...fixture, id: 'second', fieldSessionId: session.id });
  session.notes = [first];
  const manager = { current: { id: 'p', notes: [first, second] }, persistCurrentIfSaved() {} };
  let stored;
  const store = { async save(value) { stored = structuredClone(value); return { ...stored, revision: 2 }; } };
  const field = new FieldSessionController(manager, events, store);
  assert.deepEqual(await field.resume(session), { restored: 2, merged: 1 });
  assert.deepEqual(stored.notes.map(note => note.id), ['first', 'second']);
  assert.deepEqual(manager.current.notes.map(note => note.id), ['first', 'second']);
  const conflictProject = { id: 'p', notes: [{ ...first, body: 'changed' }] };
  const conflict = new FieldSessionController({ current: conflictProject }, events, store);
  await assert.rejects(conflict.resume(session), /different contents/);
  assert.equal(conflictProject.notes[0].body, 'changed');
  const failingProject = { id: 'p', notes: [second] };
  const failing = new FieldSessionController({ current: failingProject }, events, { async save() { throw new Error('disk full'); } });
  await assert.rejects(failing.resume(session), /disk full/);
  assert.deepEqual(failingProject.notes.map(note => note.id), ['second']);
});

test('twenty saved field observations survive controller recreation and resume', async () => {
  const { FieldSessionController } = await import('../js/field-session-store.js');
  let stored;
  const store = { async save(value) { stored = structuredClone({ ...value, revision: (value.revision || 0) + 1 }); return structuredClone(stored); } };
  const original = { current: { id: 'p', notes: [] }, persistCurrentIfSaved() {} };
  const field = new FieldSessionController(original, events, store);
  for (let i = 0; i < 20; i++) await field.mutate('create', { body: `Observation ${i}`, anchor: point, coordinateSource: 'map-selected' });
  const restored = { current: { id: 'p', notes: structuredClone(original.current.notes) }, persistCurrentIfSaved() {} };
  const newController = new FieldSessionController(restored, events, store);
  await newController.resume(structuredClone(stored));
  assert.equal(restored.current.notes.length, 20);
  assert.equal(restored.current.notes[19].body, 'Observation 19');
  await newController.mutate('create', { body: 'After resume', anchor: point });
  assert.equal(stored.notes.length, 21);
});

test('portable field session bundles retain 100 observations, metadata, and feature references', async () => {
  const { makeFieldBundle, normalizeFieldBundle } = await import('../js/field-session-bundle.js');
  const { newFieldSession } = await import('../js/field-session-store.js');
  const session = { ...newFieldSession({ id: 'project-1', notes: [] }), title: 'Survey', description: 'Field work', collector: 'A' };
  const notes = Array.from({ length: 100 }, (_, i) => normalizeNote({ ...fixture, id: `note-${i}`, fieldSessionId: session.id, coordinateSource: 'gps', accuracyMeters: 5, observedAt: fixture.createdAt }));
  const parsed = normalizeFieldBundle(JSON.parse(JSON.stringify(makeFieldBundle(session, notes))));
  assert.equal(parsed.notes.length, 100); assert.equal(parsed.session.collector, 'A');
  assert.equal(parsed.notes[99].relationships[0].featureId, '42'); assert.equal(parsed.notes[0].accuracyMeters, 5);
  assert.throws(() => normalizeFieldBundle({ ...parsed, session: { ...parsed.session, token: 'secret' } }), /Unsupported/);
  assert.throws(() => normalizeFieldBundle({ ...parsed, notes: null }), /observation list/);
});

test('field imports are idempotent and reject conflicting revisions without changing the project', async () => {
  const { FieldSessionController, newFieldSession } = await import('../js/field-session-store.js');
  const { makeFieldBundle } = await import('../js/field-session-bundle.js');
  const session = newFieldSession({ id: 'source', notes: [] });
  const notes = [normalizeNote({ ...fixture, fieldSessionId: session.id })];
  const bundle = makeFieldBundle(session, notes);
  const storage = new Map();
  const store = { async get(id) { return storage.get(id) || null; }, async save(value) { const saved = structuredClone({ ...value, revision: (value.revision || 0) + 1 }); storage.set(saved.id, saved); return saved; } };
  const manager = { current: { id: 'target', notes: [] }, persistCurrentIfSaved() {} };
  const field = new FieldSessionController(manager, events, store);
  assert.deepEqual(await field.importBundle(bundle), { added: 1, skipped: 0 });
  assert.deepEqual(await field.importBundle(bundle), { added: 0, skipped: 1 });
  assert.equal(manager.current.notes.length, 1);
  await assert.rejects(field.importBundle({ ...bundle, notes: [{ ...notes[0], body: 'different' }] }), /different contents/);
  assert.equal(manager.current.notes[0].body, 'Incorrect');
  const other = new FieldSessionController({ current: { id: 'new', notes: [] }, persistCurrentIfSaved() {} }, events, store);
  assert.deepEqual(await other.importBundle(bundle), { added: 0, skipped: 1 });
  assert.equal(other.projectManager.current.notes.length, 1);
  await assert.rejects(other.importBundle({ ...bundle, session: { ...bundle.session, title: 'changed' } }), /different title/);
});

test('observer GPS is independent of note anchor and survives portable export', async () => {
  const { makeFieldBundle } = await import('../js/field-session-bundle.js');
  const observerPosition = { coordinates: [-122.271, 37.801], accuracyMeters: 7, capturedAt: fixture.createdAt };
  const note = normalizeNote({ ...fixture, observerPosition });
  assert.notDeepEqual(note.anchor.geometry.coordinates, observerPosition.coordinates);
  assert.deepEqual(makeFieldBundle(null, [note]).notes[0].observerPosition, observerPosition);
  assert.throws(() => normalizeNote({ ...fixture, observerPosition: { ...observerPosition, coordinates: [0, 100] } }), /coordinate/);
  assert.throws(() => normalizeNote({ ...fixture, observerPosition: { ...observerPosition, accuracyMeters: -3 } }), /accuracy/);
});

test('feature references use stable IDs and never include credentials', async () => {
  const { noteFeatureReference } = await import('../js/map-note-feature.js');
  const layer = { id: 'layer-1', objectIdField: 'OBJECTID', title: 'Buildings' };
  const config = { id: 'layer-1', url: 'https://example.test/FeatureServer/0' };
  const result = { kind: 'feature', layerTitle: 'Buildings', attributes: { OBJECTID: 42 }, source: { objectIdField: 'OBJECTID', url: config.url } };
  const ref = noteFeatureReference(result, layer, config);
  assert.equal(ref.featureId, '42'); assert.equal(ref.sourceUrl, config.url);
  const note = normalizeNote({ ...fixture, relationships: [ref] });
  assert.deepEqual(note.relationships[0], ref);
  const unstable = noteFeatureReference({ ...result, source: { objectIdField: '__OBJECTID' }, attributes: { __OBJECTID: 1 } }, layer, config);
  assert.equal(unstable.type, 'references_dataset'); assert.equal(unstable.featureId, undefined);
  const secret = noteFeatureReference({ ...result, source: { objectIdField: 'OBJECTID', url: 'https://example.test/FeatureServer/0?token=secret' } }, layer, config);
  assert.equal(secret.sourceUrl, undefined); assert.equal(secret.datasetId, 'layer-1');
  assert.throws(() => normalizeNote({ ...fixture, relationships: [{ ...ref, sourceUrl: 'https://example.test/?token=secret' }] }), /credential/i);
});

test('portable observation links preserve the canonical note and session without truncation', async () => {
  const { createFieldNoteUrl, readFieldNoteHash } = await import('../js/field-note-link.js');
  const { newFieldSession } = await import('../js/field-session-store.js');
  const session = { ...newFieldSession({ id: 'p', notes: [] }), title: 'Survey 🗺️' };
  const note = normalizeNote({ ...fixture, title: 'Bridge 🐉', fieldSessionId: session.id });
  const url = createFieldNoteUrl('https://gismap.online/?token=do-not-keep#old', session, note);
  assert.equal(new URL(url).search, '');
  assert.ok(!url.includes('do-not-keep'));
  const restored = readFieldNoteHash(new URL(url).hash);
  assert.deepEqual(restored.notes, [note]);
  assert.equal(restored.session.title, 'Survey 🗺️');
  assert.equal(readFieldNoteHash('#at=1,2'), null);
  assert.throws(() => readFieldNoteHash('#fieldNote=j1.%%%'), /damaged|incomplete/);
  assert.throws(() => readFieldNoteHash('#fieldNote=z1.abc'), /unsupported/);
  assert.throws(() => createFieldNoteUrl('https://gismap.online/', session, { ...note, body: 'x'.repeat(5000) }), /too large/);
  assert.throws(() => createFieldNoteUrl('https://gismap.online/', session, { ...note, anchor: { type: 'area', crs: 'EPSG:4326', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] } } }), /point observations/);
});

test('the single-observation QR payload decodes to the same portable link', async () => {
  const { readFile } = await import('node:fs/promises');
  const vm = await import('node:vm');
  const { createRequire } = await import('node:module');
  const { createFieldNoteUrl, readFieldNoteHash } = await import('../js/field-note-link.js');
  const context = { TextEncoder, Uint8Array, Uint8ClampedArray, ArrayBuffer };
  vm.runInNewContext(await readFile(new URL('../js/vendor/qrcode-1.5.4.js', import.meta.url), 'utf8'), context);
  const jsQR = createRequire(import.meta.url)('../js/vendor/jsqr-1.4.0.js');
  const note = normalizeNote(fixture);
  const url = createFieldNoteUrl('https://gismap.online/', null, note);
  const qr = context.QRCode.create(url, { errorCorrectionLevel: 'L' });
  const scale = 5, margin = 4, side = (qr.modules.size + 2 * margin) * scale;
  const pixels = new Uint8ClampedArray(side * side * 4); pixels.fill(255);
  for (let y = 0; y < qr.modules.size; y++) for (let x = 0; x < qr.modules.size; x++) {
    if (!qr.modules.get(y, x)) continue;
    for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
      const offset = (((y + margin) * scale + dy) * side + (x + margin) * scale + dx) * 4;
      pixels[offset] = pixels[offset + 1] = pixels[offset + 2] = 0;
    }
  }
  const decoded = jsQR(pixels, side, side);
  assert.equal(decoded?.data, url);
  assert.deepEqual(readFieldNoteHash(new URL(decoded.data).hash).notes, [note]);
});
