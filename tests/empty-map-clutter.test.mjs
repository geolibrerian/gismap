import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the welcome panel and data shortcuts remain available without automatic suggestions after loading data', async () => {
  const [html, ui, css, workspace, appCss] = await Promise.all([
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/fieldwork.css', import.meta.url), 'utf8'),
    readFile(new URL('../js/fieldwork-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/app.css', import.meta.url), 'utf8'),
  ]);
  const welcome = html.match(/<section id="welcome-panel"[\s\S]*?<\/section>/)?.[0];
  assert.ok(welcome);
  // The catalog is the one data entry point on the welcome card; other sources stay in the Data menu.
  assert.doesNotMatch(welcome, /data-action="data-(?!popular")/);
  assert.doesNotMatch(css, /empty-state--layers \.empty-state__actions\s*\{\s*display:\s*none/);
  assert.doesNotMatch(ui, /this\.#initContextualWorkspace\(\)/);
  assert.match(appCss, /\.context-workspace\s*\{[^}]*left:50%; top:16px/);
  assert.doesNotMatch(workspace, /\+ Add layer/);
  for (const source of ['data-file', 'data-arcgis', 'data-geojson', 'data-popular']) {
    assert.ok(html.includes(`data-empty-action="${source}"`), 'empty layer shortcuts remain available');
    assert.ok(html.includes(`data-action="${source}"`), 'Data menu remains available after a layer is added');
  }
});
