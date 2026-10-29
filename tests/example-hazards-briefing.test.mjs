import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HISTORICAL_QUAKES_SOURCE,
  HISTORICAL_QUAKES_WHERE,
  createHistoricalQuakesExampleBriefing,
} from '../js/example-hazards-briefing.js';
import { normalizeBriefing } from '../js/briefing-document.js';

const quakeRef = HISTORICAL_QUAKES_SOURCE;
const featuredEvents = [
  { attributes: { OBJECTID: 1, title: 'M 9.5 — Example event', place: 'Example place', mag: 9.5, depth: 25, time: -303281320000, sig: 1388 }, geometry: { x: -73.4, y: -38.1 } },
  { attributes: { OBJECTID: 2, title: 'M 9.2 — Example event', place: 'Another place', mag: 9.2, depth: 30, time: -181859024000, sig: 1713 }, geometry: { x: -147.3, y: 60.9 } },
];

test('Historical Quakes example is an editable briefing with moving opening views and a temporary seismic pulse', () => {
  const briefing = createHistoricalQuakesExampleBriefing({ quakeRef, featuredEvents });
  assert.equal(briefing.layerId, quakeRef);
  assert.equal(briefing.playerSettings.basemap, 'topo-vector');
  assert.equal(briefing.slides.length, 7);
  assert.ok(briefing.slides.every((slide) => slide.layers?.every((layer) => layer.layer === quakeRef && layer.visible)));
  assert.equal(briefing.slides[2].template, 'map-narrative');
  assert.deepEqual(briefing.slides[2].mapEffect, { layer: quakeRef, type: 'pulse', color: '#ff4a3d', intensity: 1.25, opacity: 0.88, speed: 0.8, density: 0.8, style: 'balanced' });
  assert.deepEqual(briefing.slides.map((slide) => slide.mapEngine), ['arcgis', 'arcgis', 'maplibre', 'arcgis', 'arcgis', 'arcgis', 'arcgis']);
  assert.deepEqual(briefing.slides.map((slide) => slide.id), ['historical-quakes-title', 'historical-quakes-archive', 'historical-quakes-pulse', 'historical-quakes-event-1', 'historical-quakes-event-2', 'historical-quakes-patterns', 'historical-quakes-actions']);
  assert.notDeepEqual(briefing.slides[0].camera, briefing.slides[1].camera, 'the first two slides deliberately move the map');
  assert.notDeepEqual(briefing.slides[1].camera, briefing.slides[2].camera, 'the pulse slide moves to a closer view');
  assert.deepEqual(briefing.slides[3].camera.center, [-73.4, -38.1], 'event slides use the event location rather than the overview');
  assert.ok(briefing.slides.some((slide) => slide.template === 'feature' && slide.featureId === '1'));
  assert.match(briefing.slides[1].blocks[0].markdown, /MapLibre pulse for presentation/);
  assert.ok(briefing.slides.every((slide) => !/hurricane/i.test(`${slide.title} ${JSON.stringify(slide.blocks)}`)));
  assert.deepEqual(normalizeBriefing(JSON.parse(JSON.stringify(briefing))), briefing);
  assert.throws(() => createHistoricalQuakesExampleBriefing({ featuredEvents }), /Historical Quakes layer/);
});

test('briefing entry point preserves an existing briefing and uses the bounded stable service query', async () => {
  const ui = await readFile(new URL('../js/ui.js', import.meta.url), 'utf8');
  assert.match(ui, /Open Historical Quakes briefing/);
  assert.match(ui, /project\.presentation\?\.briefing\?\.slides\?\.length && !confirm/);
  assert.match(ui, /briefing changed while the example was loading/);
  assert.match(ui, /HISTORICAL_QUAKES_WHERE/);
  assert.match(ui, /Historical Quakes — M6\.5\+/);
  assert.match(ui, /definitionExpression: HISTORICAL_QUAKES_WHERE/);
  assert.match(ui, /ignoreScaleRange\?\.\(earthquakeLayer\.uid, true\)/);
  assert.match(ui, /title: 'Historical Quakes briefing'/);
  assert.match(ui, /tutorial: 'historical-quakes-briefing'/);
  assert.match(ui, /this\.activateExampleGuide\(/);
  assert.match(ui, /#ensureHistoricalQuakesSlideEngine\(slide\)/);
  assert.match(ui, /url\.searchParams\.set\('engine', target\)/);
  assert.equal(HISTORICAL_QUAKES_WHERE, 'mag >= 6.5');
});

test('the public Historical Quakes URL launches the finished briefing and its walkthrough', async () => {
  const [app, examples, learn] = await Promise.all([
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../discover/examples/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../discover/learn/index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /briefingExample"\) === "historical-quakes"/);
  assert.match(app, /historicalQuakesBriefing && !launchParams\.has\("engine"\)/);
  assert.match(app, /\? "arcgis"/);
  assert.doesNotMatch(app, /\? "maplibre"\s*:\s*chooseEngine/);
  assert.match(app, /briefingPresent"\) === "1"/);
  assert.match(app, /openHistoricalQuakesBriefingExample\(\{/);
  for (const page of [examples, learn]) assert.match(page, /briefingExample=historical-quakes&amp;tutorial=1/);
});
