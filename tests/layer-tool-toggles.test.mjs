import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('layer cards toggle open tools and expose source provenance instead of a duplicate share action', async () => {
  const [ui, table, html] = await Promise.all([
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/attribute-table.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.match(table, /subscribe\("table:toggle", \(\{ uid \}\) => this\.toggle\(uid\)\)/);
  assert.match(table, /toggle\(uid\) \{[\s\S]*this\.dialog\.open && this\.state\.rootUid === uid[\s\S]*#cancelAndReset\(\)/);
  assert.match(ui, /case "table": this\.events\.publish\("table:toggle", \{ uid \}\)/);
  assert.match(ui, /utilityQueryLayerUid/);
  assert.match(ui, /utilityDialogLayerTool/);
  assert.match(ui, /case "source":[\s\S]*#openLayerSource\(uid\)/);
  assert.match(ui, /Open source in a new tab/);
  assert.doesNotMatch(ui, /data-layer-action="export" title="Share this map/);
  assert.match(html, /id="utility-source-content"[^>]*data-utility-pane="source"/);
});
