import test from 'node:test';
import assert from 'node:assert/strict';
import { DataMapNotesRegistry } from '../js/data-map-notes.js';
import { openDataMapNotesPanel } from '../js/data-map-notes-panel.js';

function workspace(registry) {
  const controls = Object.fromEntries(['targetType', 'datasetId', 'featureId', 'sourceUrl', 'longitude', 'latitude', 'category', 'title', 'body', 'tags', 'status'].map(name => [name, { value: '', addEventListener() {} }]));
  const save = { disabled: false, addEventListener(_type, handler) { this.click = () => handler({ currentTarget: this }); } };
  const error = { textContent: '' };
  const target = { hidden: false };
  const form = { querySelector(selector) { return selector.startsWith('[name=') ? controls[selector.match(/"(.*?)"/)[1]] : selector === '[data-map-note-save]' ? save : selector === '[data-map-note-error]' ? error : target; } };
  let html = '';
  const host = { querySelector: selector => selector === '[data-data-note-form]' ? form : null, querySelectorAll: () => [] };
  const ui = { projectManager: { mapNotes: registry }, openDataMapNotesWorkspace(content) { html = content; return host; }, toast() {}, error() {} };
  return { ui, controls, save, error, html: () => html };
}

test('workspace creates a data note and displays its text safely', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui);
  Object.assign(w.controls.targetType, { value: 'feature' }); w.controls.datasetId.value = 'parcels'; w.controls.featureId.value = '42';
  w.controls.body.value = '<img src=x onerror=alert(1)>'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
  w.save.click();
  assert.equal(registry.list()[0].target.featureId, '42');
  assert.match(w.html(), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(w.html(), /<img src=x/);
});

test('editing keeps optional target context and unchanged tags', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project });
  const note = registry.create({ body: 'Review', tags: ['a,b'], target: { type: 'feature', datasetId: 'parcels', featureId: '42', coordinates: [-122, 37] } });
  const w = workspace(registry); openDataMapNotesPanel(w.ui, { editId: note.id });
  for (const [name, value] of Object.entries({ targetType: 'feature', datasetId: 'parcels', featureId: '42', body: 'Reviewed', tags: 'a,b', category: 'other', status: 'open' })) w.controls[name].value = value;
  w.save.click();
  assert.deepEqual(registry.get(note.id).target.coordinates, [-122, 37]); assert.deepEqual(registry.get(note.id).tags, ['a,b']);
});

test('location notes reject missing coordinates without writing', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui); w.controls.targetType.value = 'location'; w.save.click();
  assert.match(w.error.textContent, /both longitude and latitude/); assert.equal(registry.list().length, 0); assert.equal(w.save.disabled, false);
});
