import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('empty map retains layer shortcuts and creative suggestions live over the map', async () => {
  const [html, ui, css, workspace, appCss] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/fieldwork.css', import.meta.url), 'utf8'),
    readFile(new URL('../js/fieldwork-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/app.css', import.meta.url), 'utf8'),
  ]);
  const welcome = html.match(/<section id="welcome-panel"[\s\S]*?<\/section>/)?.[0];
  assert.ok(welcome);
  assert.doesNotMatch(welcome, /data-action="data-/);
  assert.doesNotMatch(css, /empty-state--layers \.empty-state__actions\s*\{\s*display:\s*none/);
  assert.match(ui, /querySelector\("#map-status"\)\?\.before\(host\)/);
  assert.match(appCss, /\.context-workspace\s*\{[^}]*left:50%; top:16px/);
  assert.doesNotMatch(workspace, /\+ Add layer/);
  for (const source of ['data-file', 'data-arcgis', 'data-geojson', 'data-popular']) {
    assert.ok(html.includes(`data-empty-action="${source}"`), 'empty layer shortcuts remain available');
    assert.ok(html.includes(`data-action="${source}"`), 'Data menu remains available after a layer is added');
  }
});
