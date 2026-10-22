import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WALKTHROUGH_STEPS } from '../js/workspace-walkthrough.js';

test('walkthrough has a concise desktop and mobile overview', () => {
  assert.ok(WALKTHROUGH_STEPS.length >= 5 && WALKTHROUGH_STEPS.length <= 10);
  for (const step of WALKTHROUGH_STEPS) {
    assert.ok(step.title && step.description && step.desktop && step.mobile);
  }
  for (const title of ['The map', 'Menus', 'Layers and data', 'Map controls', 'Project and sharing']) {
    assert.ok(WALKTHROUGH_STEPS.some(step => step.title === title));
  }
});

test('walkthrough can be started from suggestions or the Tools menu', async () => {
  const [ui, html] = await Promise.all([
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(ui, /Walk me through the tools and menus/);
  assert.match(ui, /case "tools-walkthrough"/);
  assert.match(html, /data-action="tools-walkthrough"/);
  assert.match(ui, /#startWorkspaceWalkthrough\(\)\s*\{\s*this\.#dismissWelcome\(\);\s*startWorkspaceWalkthrough/);
  assert.equal((ui.match(/this\.#startWorkspaceWalkthrough\(\)/g) || []).length, 2);
});
