import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const ids = ['interactive-map', 'interactive-briefing', 'geographic-tour', 'field-tasks', '3d-extrusion', 'spatial-3d-chart', 'lidar-and-3d-models', 'vibe-map'];
test('the eight composable recipes are discoverable from llms and both skill surfaces', async () => {
  const [llms, html, skill, reference] = await Promise.all(['llms.txt', 'skills/index.html', 'skills/gismap/SKILL.md', 'skills/gismap/references/agent-recipes.md'].map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')));
  for (const id of ids) {
    assert.ok(llms.includes(`/skills/#recipe-${id}`), `llms ${id}`);
    assert.ok(html.includes(`id="recipe-${id}"`), `skills page ${id}`);
    assert.ok(skill.includes(`references/agent-recipes.md#${id}`), `skill ${id}`);
    assert.ok(reference.includes(`id="${id}"`), `reference ${id}`);
  }
  assert.match(llms, /Combine recipes/);
  assert.match(skill, /Recipes are composable/);
  assert.match(reference, /Never claim a later stage solely because a URL was generated/);
});
