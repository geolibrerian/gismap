import test from 'node:test';
import assert from 'node:assert/strict';
import { renderNotesHub } from '../js/notes-hub.js';
import { readFileSync } from 'node:fs';

test('notes hub shows project-specific counts and escapes user content', () => {
  const html = renderNotesHub({ projectName: '<Project>', mapNotes: [{ id: '1', title: '<note>', status: 'open' }], fieldNotes: [{ id: '2' }], tasks: [] });
  assert.match(html, /&lt;Project&gt;/); assert.match(html, /&lt;note&gt;/);
  assert.match(html, /Map Notes<span>1/); assert.match(html, /Field Notes<span>1/);
  assert.doesNotMatch(html, /<note>/); assert.match(html, /data-notes-hub="pdf"\s*>/);
});
test('empty and task views include honest shortcuts and disable empty PDF', () => {
  const html = renderNotesHub({ tab: 'tasks', tasks: [{ id: 'x', title: 'Inspect', status: 'open' }] });
  assert.match(html, /Inspect/); assert.match(html, /Open Field Tasks/);
  assert.match(html, /data-notes-hub="pdf" disabled/); assert.match(html, /QR card/);
});
test('hub is hidden by default and participates in the dockable panel system', () => {
  const index = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const ui = readFileSync(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(index, /id="observations-panel" class="panel is-sidebar-optional-hidden"/);
  assert.match(index, /data-sidebar-panel-toggle="observations-panel"/);
  assert.match(ui, /observations: "Notes & Tasks"/);
  assert.match(ui, /observationsPanelVisible: saved.observationsPanelVisible === true/);
});
