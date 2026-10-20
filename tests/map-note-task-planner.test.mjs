import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectManager } from '../js/project.js';
import { serializeFieldTask } from '../js/field-task-share.js';
const map = { getDefaultBasemapId: () => 'x', getBasemapId: () => 'x', getGroundId: () => 'flat', getViewState: () => ({}), getAllLayerConfigs: () => [] };
function manager() { const value = new ProjectManager({ publish() {} }, map); value.mapNotes.persist = () => {}; return value; }
function note(m, body, target = { type: 'project' }) { return m.mapNotes.create({ title: body, body, target }); }

test('preview and commit create linked draft tasks without changing notes', () => {
  const m = manager(), a = note(m, 'Inspect bridge'), b = note(m, 'Review site', { type: 'location', coordinates: [-122, 37] });
  const preview = m.previewTasksFromMapNotes({ mapNoteIds: [a.id, b.id] });
  assert.equal(preview.tasks.length, 2); assert.equal(m.current.mobile.fieldTasks.length, 0);
  const tasks = m.createTasksFromMapNotes(preview);
  assert.equal(tasks.length, 2); assert.equal(tasks[0].status, 'draft'); assert.equal(tasks[0].latitude, undefined); assert.equal(tasks[1].latitude, 37);
  assert.equal(m.current.noteRelationships.length, 2); assert.equal(m.mapNotes.get(a.id).status, 'open');
  assert.equal(m.mapNotes.getWorkflowSummary(a.id).outstanding, 1);
  assert.throws(() => m.createTasksFromMapNotes(preview), /changed/);
  const again = m.previewTasksFromMapNotes({ mapNoteIds: [a.id, b.id] }); assert.equal(again.tasks.length, 0); assert.equal(again.skipped.length, 2);
});

test('combined tasks create multiple relationships and follow-up requires explicit choice', () => {
  const m = manager(), a = note(m, 'A'), b = note(m, 'B');
  const tasks = m.createTasksFromMapNotes(m.previewTasksFromMapNotes({ mapNoteIds: [a.id, b.id], strategy: 'combined' }));
  assert.equal(tasks.length, 1); assert.equal(m.current.noteRelationships.length, 2);
  assert.equal(m.noteRelationships.getRelated({ type: 'field-task', id: tasks[0].id }).length, 2);
  assert.equal(m.previewTasksFromMapNotes({ mapNoteIds: [a.id] }).skipped.length, 1);
  assert.equal(m.previewTasksFromMapNotes({ mapNoteIds: [a.id], skipOutstanding: false }).tasks.length, 1);
});

test('invalid, long, missing and changed previews create nothing', () => {
  const m = manager(), a = note(m, 'A'), b = m.mapNotes.create({ body: 'x'.repeat(501), target: { type: 'project' } });
  assert.throws(() => m.previewTasksFromMapNotes({ mapNoteIds: [a.id, b.id] }), /exceed/);
  assert.throws(() => m.previewTasksFromMapNotes({ mapNoteIds: [a.id, 'missing'] }), /no longer exists/);
  const preview = m.previewTasksFromMapNotes({ mapNoteIds: [a.id] }); m.mapNotes.update(a.id, { body: 'Changed' });
  assert.throws(() => m.createTasksFromMapNotes(preview), /changed/);
  assert.deepEqual(m.current.mobile.fieldTasks, []); assert.deepEqual(m.current.noteRelationships, []);
});

test('saved project task batch rolls back on write failure', () => {
  const old = globalThis.localStorage; const data = new Map(); let fail = false;
  globalThis.localStorage = { getItem: k => data.get(k) || null, setItem: (k, v) => { if (fail) throw new Error('storage full'); data.set(k, v); } };
  try {
    const m = manager(), a = note(m, 'A'); m.save();
    const original = data.get('gismap-online:projects:v1'); const preview = m.previewTasksFromMapNotes({ mapNoteIds: [a.id] }); fail = true;
    assert.throws(() => m.createTasksFromMapNotes(preview), /storage full/);
    assert.deepEqual(m.current.mobile.fieldTasks, []); assert.deepEqual(m.current.noteRelationships, []); assert.equal(data.get('gismap-online:projects:v1'), original);
  } finally { globalThis.localStorage = old; }
});

test('saved project persists tasks and relationships together and tasks fit existing QR format', () => {
  const old = globalThis.localStorage; const data = new Map();
  globalThis.localStorage = { getItem: k => data.get(k) || null, setItem: (k, v) => data.set(k, v) };
  try {
    const m = manager(), a = note(m, 'Inspect location', { type: 'location', coordinates: [-122, 37] }); m.save();
    const [task] = m.createTasksFromMapNotes(m.previewTasksFromMapNotes({ mapNoteIds: [a.id] }));
    const stored = JSON.parse(data.get('gismap-online:projects:v1'))[m.current.id];
    assert.equal(stored.mobile.fieldTasks[0].id, task.id);
    assert.equal(stored.noteRelationships.length, 1);
    const card = serializeFieldTask(task, 'assign');
    assert.equal(card.t, task.title);
    assert.equal(card.y, 37);
  } finally { globalThis.localStorage = old; }
});
