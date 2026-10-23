import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseHurricaneLayer, createHazardsExampleBriefing } from '../js/example-hazards-briefing.js';
import { normalizeBriefing } from '../js/briefing-document.js';

test('example is an editable briefing with both live sources and no fabricated counts', () => {
  const earthquakeRef = 'https://example.test/earthquakes/0';
  const hurricaneRef = 'https://example.test/hurricanes/1';
  const briefing = createHazardsExampleBriefing({ earthquakeRef, hurricaneRef, hurricaneLayerName: 'Forecast Position' });
  assert.equal(briefing.layerId, earthquakeRef);
  assert.equal(briefing.slides.length, 5);
  assert.deepEqual(briefing.slides.map(slide => slide.layers.map(layer => [layer.layer, layer.visible])), [
    [[earthquakeRef, true], [hurricaneRef, true]],
    [[earthquakeRef, false], [hurricaneRef, true]],
    [[earthquakeRef, true], [hurricaneRef, false]],
    [[earthquakeRef, true], [hurricaneRef, true]],
    [[earthquakeRef, true], [hurricaneRef, true]],
  ]);
  assert.notDeepEqual(briefing.slides[1].camera, briefing.slides[2].camera);
  assert.ok(briefing.slides.some(slide => slide.title === 'Recent earthquakes'));
  assert.ok(briefing.slides.some(slide => slide.title === 'Active hurricanes'));
  assert.match(briefing.slides.find(slide => slide.title === 'Active hurricanes').blocks[0].markdown, /Forecast Position/);
  assert.ok(briefing.slides.every(slide => !slide.blocks.some(block => block.type === 'stat')));
  assert.deepEqual(normalizeBriefing(JSON.parse(JSON.stringify(briefing))), briefing);
  assert.throws(() => createHazardsExampleBriefing({ earthquakeRef }), /Both example layers/);
});

test('hurricane discovery prefers current locations and handles empty services', () => {
  const choices = [{ name: 'Forecast area', url: 'a' }, { name: 'Current storm position', url: 'b' }];
  assert.equal(chooseHurricaneLayer(choices).url, 'b');
  assert.equal(chooseHurricaneLayer([]), null);
});

test('briefing entry point preserves an existing briefing before replacement', async () => {
  const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /Try an example briefing/);
  assert.match(ui, /project\.presentation\?\.briefing\?\.slides\?\.length && !confirm/);
  assert.match(ui, /briefing changed while the example was loading/);
});
