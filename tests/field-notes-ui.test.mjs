import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { openMapNotesPanel } from '../js/map-notes-panel.js';

test('Field Notes opens to an overview and switches to its editor without rebuilding', () => {
  const controls = {};
  for (const key of ['[data-field-note-editor]', '[data-field-note-overview]', '[data-field-note-new]', '[data-field-note-back]']) controls[key] = { hidden: false, addEventListener(_name, fn) { this.click = fn; } };
  const status = { isConnected: false };
  const host = { isConnected: true, querySelector: selector => controls[selector] || (selector === '[data-field-storage]' ? status : null), querySelectorAll: () => [] };
  let html = '', cursorChanges = 0;
  const ui = { projectManager: { current: { id: 'project' }, notes: { list: () => [] } }, fieldSessionController: { session: null, store: { list: async () => [] } }, mobileMedia: { matches: false }, openMapNotesWorkspace(value) { html = value; return host; }, updateFieldNotesCursor() { cursorChanges++; }, refreshMapNoteMarkers() {} };
  openMapNotesPanel(ui);
  assert.match(html, /data-field-note-editor[^>]*hidden/);
  assert.match(html, /\+ New field note/);
  assert.match(html, /No field notes/);
  assert.match(html, /Field notes for review \(0\)/);
  assert.match(html, /data-field-notes-review/);
  assert.equal(ui.fieldNotesEditing, false);
  controls['[data-field-note-new]'].click();
  assert.equal(ui.fieldNotesEditing, true); assert.equal(controls['[data-field-note-overview]'].hidden, true);
  controls['[data-field-note-back]'].click();
  assert.equal(ui.fieldNotesEditing, false); assert.equal(controls['[data-field-note-editor]'].hidden, true);
  assert.equal(cursorChanges, 3);
});

test('map selection is gated to the Field Notes editor and the editor uses task surfaces', async () => {
  const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(ui, /!this\.mapNotesModeActive \|\| !this\.fieldNotesEditing/);
  assert.match(css, /\.field-notes-panel \[data-field-note-overview\] \.mobile-primary/);
  assert.match(css, /field-notes-editor__card :is\(input[^}]*background: var\(--surface-2\)/);
});


test('review cards display saved notes safely and Modes labels use sentence case', async () => {
  const source = await readFile(new URL('../js/map-notes-panel.js', import.meta.url), 'utf8');
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(source, /class="feed-card map-note-card field-note-review-card"/);
  assert.match(source, /escape\(item\.title/);
  assert.match(source, /data-note-edit=.*Review &amp; edit/);
  assert.match(html, /data-action="mode-map-notes">Field notes</);
  assert.match(html, /data-action="mode-data-map-notes">Map notes</);
});
