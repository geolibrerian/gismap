import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('workspace pins use an accessible icon with a distinct pressed state', async () => {
  const [workspace, css] = await Promise.all([
    readFile(new URL('../js/fieldwork-workspace.js', import.meta.url), 'utf8'),
    readFile(new URL('../css/fieldwork.css', import.meta.url), 'utf8'),
  ]);
  assert.match(workspace, /workspace-pin__head/);
  assert.match(workspace, /aria-pressed', String\(pinned\)/);
  assert.match(workspace, /aria-label', `\$\{pinned \? 'Unpin' : 'Pin'\} \$\{label\}`/);
  assert.doesNotMatch(workspace, /button\.textContent = pinned/);
  assert.match(css, /workspace-pin\[aria-pressed="true"\] \.workspace-pin__head\s*\{\s*fill:currentColor/);
});
