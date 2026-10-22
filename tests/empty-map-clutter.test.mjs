import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('empty desktop map has one data entry point without duplicate suggestions', async () => {
  const [html, ui, css, workspace] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/fieldwork.css', import.meta.url), 'utf8'),
    readFile(new URL('../js/fieldwork-workspace.js', import.meta.url), 'utf8'),
  ]);
  const welcome = html.match(/<section id="welcome-panel"[\s\S]*?<\/section>/)?.[0];
  assert.ok(welcome);
  assert.doesNotMatch(welcome, /data-action="data-/);
  assert.match(ui, /const suppressed = !layers\.length \|\| featureSelected/);
  assert.match(css, /body\.fieldwork-desktop \.empty-state--layers \.empty-state__actions\s*\{\s*display:\s*none/);
  for (const source of ['data-file', 'data-arcgis', 'data-geojson', 'data-popular']) {
    assert.ok(workspace.includes(`data-studio-source="${source}"`));
    assert.ok(html.includes(`data-empty-action="${source}"`), 'fallback remains available outside desktop fieldwork');
  }
});
