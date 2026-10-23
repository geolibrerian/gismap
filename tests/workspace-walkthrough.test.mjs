import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BRIEFING_WALKTHROUGH_STEPS, WALKTHROUGH_STEPS, waitForWalkthroughTarget } from '../js/workspace-walkthrough.js';

test('walkthrough has a concise desktop and mobile overview', () => {
  assert.ok(WALKTHROUGH_STEPS.length >= 5 && WALKTHROUGH_STEPS.length <= 10);
  for (const step of WALKTHROUGH_STEPS) {
    assert.ok(step.title && step.description && step.desktop && step.mobile);
  }
  for (const title of ['The map', 'Menus', 'Layers and data', 'Map controls', 'Project and sharing']) {
    assert.ok(WALKTHROUGH_STEPS.some(step => step.title === title));
  }
});

test('briefing guide covers the workflow without requiring a loaded dataset', async () => {
  assert.ok(BRIEFING_WALKTHROUGH_STEPS.length >= 5 && BRIEFING_WALKTHROUGH_STEPS.length <= 10);
  for (const title of ['Start with data', 'Try a finished example', 'Choose your features', 'Build your slides', 'Arrange and review', 'Preview and share']) {
    assert.ok(BRIEFING_WALKTHROUGH_STEPS.some(step => step.title === title));
  }
  const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /data-presentation-setup="briefing-guide"/);
  assert.match(ui, /steps: BRIEFING_WALKTHROUGH_STEPS/);
  assert.match(ui, /'Find a dataset'/);
  assert.match(ui, /beforeStep: async \(index, \{ signal \}\)/);
  assert.match(ui, /if \(index < 3\) return true/);
  assert.match(ui, /#openExampleHazardsBriefing\(\{ signal \}\)/);
  assert.match(ui, /waitForWalkthroughTarget\(this\.mobileMedia\.matches \? step\.mobile : step\.desktop/);
  assert.match(ui, /index === 3 \? 'features' : 'slides'/);
  assert.match(BRIEFING_WALKTHROUGH_STEPS[2].description, /Next will load/);
});

test('walkthrough target waiting resolves on rendering and aborts or times out safely', async () => {
  const saved = { document: globalThis.document, MutationObserver: globalThis.MutationObserver, getComputedStyle: globalThis.getComputedStyle };
  let notify;
  let target = null;
  let disconnected = 0;
  try {
    globalThis.document = { body: {}, querySelectorAll: () => target ? [target] : [] };
    globalThis.MutationObserver = class { constructor(callback) { notify = callback; } observe() {} disconnect() { disconnected++; } };
    globalThis.getComputedStyle = () => ({ visibility: 'visible' });
    const waiting = waitForWalkthroughTarget('.target', { timeout: 100 });
    target = { getClientRects: () => [1] };
    notify();
    assert.equal(await waiting, target);
    target = null;
    const controller = new AbortController();
    const canceled = waitForWalkthroughTarget('.target', { signal: controller.signal, timeout: 100 });
    controller.abort();
    await assert.rejects(canceled, /closed/);
    await assert.rejects(waitForWalkthroughTarget('.target', { timeout: 1 }), /did not become available/);
    assert.equal(disconnected, 3);
  } finally {
    for (const [key, value] of Object.entries(saved)) value === undefined ? delete globalThis[key] : globalThis[key] = value;
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

test('the welcome panel combines the six getting-started actions', async () => {
  const [ui, html, css] = await Promise.all([
    readFile(new URL('../js/ui.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../css/app.css', import.meta.url), 'utf8'),
  ]);
  const welcome = html.match(/<section id="welcome-panel"[\s\S]*?<\/section>/)[0];
  assert.equal((welcome.match(/<(?:a|button)\b/g) || []).length, 7); // Six actions and dismiss.
  for (const label of ['Browse public GIS examples', 'Read GISMap guides', 'Walk me through the tools and menus', 'Create a briefing', 'Create a tour', 'Create a dashboard']) assert.ok(welcome.includes(label));
  assert.doesNotMatch(welcome, /Free browser-based GIS maps|Choose a data source/);
  assert.match(welcome, /href="\/examples\/"/);
  assert.match(welcome, /href="\/guides\/"/);
  assert.match(welcome, /data-action="map-presentation">Create a dashboard/);
  assert.match(ui, /openMobileWorkflow\(button\.dataset\.welcomeWorkflow\)/);
  assert.match(ui, /host\.hidden = suppressed \|\| !context\.layer/);
  assert.match(css, /\.welcome-panel \{[^}]*top: 50%; left: 50%/);
});
