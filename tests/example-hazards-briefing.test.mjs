import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  HISTORICAL_QUAKES_SOURCE,
  HISTORICAL_QUAKES_WHERE,
  createHistoricalQuakesCinematicClip,
  createHistoricalQuakesExampleBriefing,
} from '../js/example-hazards-briefing.js';
import { normalizeBriefing } from '../js/briefing-document.js';

const quakeRef = HISTORICAL_QUAKES_SOURCE;
const featuredEvents = [
  { attributes: { OBJECTID: 1, title: 'M 9.5 — Example event', place: 'Example place', mag: 9.5, depth: 25, time: -303281320000, sig: 1388 }, geometry: { x: -73.4, y: -38.1 } },
  { attributes: { OBJECTID: 2, title: 'M 9.2 — Example event', place: 'Another place', mag: 9.2, depth: 30, time: -181859024000, sig: 1713 }, geometry: { x: -147.3, y: 60.9 } },
];

test('Historical Quakes example is an editable, source-styled briefing with a portable cinematic clip', () => {
  const clip = createHistoricalQuakesCinematicClip({ quakeRef, projectId: 'project-1', observationTimes: featuredEvents.map((event) => event.attributes.time) });
  const briefing = createHistoricalQuakesExampleBriefing({ quakeRef, clip, featuredEvents });
  assert.equal(briefing.layerId, quakeRef);
  assert.equal(briefing.playerSettings.basemap, 'topo-vector');
  assert.equal(briefing.slides.length, 7);
  assert.ok(briefing.slides.every((slide) => slide.layers?.every((layer) => layer.layer === quakeRef && layer.visible)));
  assert.equal(briefing.slides[2].template, 'cinematic');
  assert.equal(briefing.slides[2].clipRef, clip.id);
  assert.equal(briefing.slides[2].clip.tracks[0].layerRef, quakeRef);
  assert.equal(briefing.slides[2].clip.tracks[0].animation.effect.type, 'none');
  assert.equal(briefing.slides[2].clip.tracks[0].temporal.startField, 'time');
  assert.equal(briefing.slides[2].clip.tracks[0].provenance.status, 'observed');
  assert.ok(briefing.slides[2].clip.cameraTrack[0].camera.zoom >= 5, 'the cinematic begins inside the service visibility scale');
  assert.ok(briefing.slides[2].clip.cameraTrack.at(-1).camera.zoom > briefing.slides[2].clip.cameraTrack[0].camera.zoom, 'the clip has a visible camera move');
  assert.ok(briefing.slides.some((slide) => slide.template === 'feature' && slide.featureId === '1'));
  assert.match(briefing.slides[1].blocks[0].markdown, /publisher’s own magnitude renderer/);
  assert.ok(briefing.slides.every((slide) => !/hurricane/i.test(`${slide.title} ${JSON.stringify(slide.blocks)}`)));
  assert.deepEqual(normalizeBriefing(JSON.parse(JSON.stringify(briefing))), briefing);
  assert.throws(() => createHistoricalQuakesExampleBriefing({ quakeRef, featuredEvents }), /cinematic Clip/);
  assert.throws(() => createHistoricalQuakesCinematicClip(), /Historical Quakes layer/);
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
  assert.equal(HISTORICAL_QUAKES_WHERE, 'mag >= 6.5');
});

test('the public Historical Quakes URL launches the finished briefing and its walkthrough', async () => {
  const [app, examples, learn] = await Promise.all([
    readFile(new URL('../js/app.js', import.meta.url), 'utf8'),
    readFile(new URL('../discover/examples/index.html', import.meta.url), 'utf8'),
    readFile(new URL('../discover/learn/index.html', import.meta.url), 'utf8'),
  ]);
  assert.match(app, /briefingExample"\) === "historical-quakes"/);
  assert.match(app, /openHistoricalQuakesBriefingExample\(\{ startTutorial: launchParams\.get\("tutorial"\) === "1" \}\)/);
  for (const page of [examples, learn]) assert.match(page, /briefingExample=historical-quakes&amp;tutorial=1/);
});
