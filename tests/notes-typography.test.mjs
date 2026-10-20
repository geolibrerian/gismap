import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('note panels use the compact Layers typography and mobile editing remains legible', async () => {
  const css = await readFile(new URL('../css/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.empty-state__actions button\s*\{[^}]*font-size:\s*12px/);
  assert.match(css, /\.notes-hub,\s*\.map-notes-panel\s*\{\s*font:\s*400 12px\/1\.5 var\(--ui-font/);
  assert.match(css, /\.map-notes-panel \.map-note-workspace-head h3\s*\{\s*font:\s*600 19px/);
  assert.match(css, /@media \(max-width: 760px\)\s*\{[^}]*\.map-notes-panel textarea\s*\{\s*font-size:\s*16px/);
});
