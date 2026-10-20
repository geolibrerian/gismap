import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapSpec, renderers } from '../js/gismap-core.js';
import { parseShareParameters } from '../js/share.js';
import { FIRE_SOURCE, FIRE_WHERE, FIRE_START_LINK, FIRE_YEAR, FIRE_ACRES, fireLink } from '../scripts/fire-refinement.mjs';

const load = name => readFile(new URL(`../examples/ai/california-fire-refinement/${name}`, import.meta.url), 'utf8');
test('follow-up views retain the parsed source, filter and view while producing distinct share links', async () => {
  const previous = new URL(FIRE_START_LINK);
  const base = mapSpec.fromShareParameters(parseShareParameters(previous.search));
  assert.equal(base.layers[0].url, FIRE_SOURCE);
  assert.equal(base.layers[0].where, FIRE_WHERE);
  for (const [name, spec] of [['year', FIRE_YEAR], ['acreage', FIRE_ACRES]]) {
    assert.deepEqual(JSON.parse(await load(`${name}.json`)), spec);
    assert.equal(spec.layers[0].where, base.layers[0].where);
    assert.equal(spec.basemap, base.basemap);
    assert.deepEqual(spec.camera.center, base.camera.center);
    const validation = mapSpec.validate(spec);
    assert.equal(validation.valid, true, JSON.stringify(validation.issues));
    assert.deepEqual(validation.issues, []);
    const decoded = await mapSpec.decode(new URL(fireLink(spec)).hash.slice(5));
    assert.deepEqual(decoded, spec);
    const report = await mapSpec.prepareVerification(spec);
    assert.equal(report.checks.linkRoundTrip, 'passed');
    assert.equal(report.checks.mapRendered, 'not_checked');
    assert.equal(report.checks.shareLinkReopened, 'not_checked');
  }
  assert.notEqual(fireLink(FIRE_YEAR), fireLink(FIRE_ACRES));
  assert.equal(Object.keys(FIRE_YEAR.layers[0].renderer.colors).length, 11);
  assert.equal(FIRE_ACRES.layers[0].renderer.field, 'GIS_ACRES');
  assert.match(await load('index.html'), /not been independently verified/);
});

test('live fire metadata and filter (not a browser rendering test)', { skip: process.env.GISMAP_LIVE_TESTS !== '1' }, async () => {
  const get = async (path, params) => {
    const response = await fetch(`${FIRE_SOURCE}${path}?${new URLSearchParams(params)}`);
    assert.equal(response.ok, true);
    const data = await response.json();
    assert.equal(data.error, undefined, JSON.stringify(data.error));
    return data;
  };
  const metadata = await get('', { f:'json' });
  assert.equal(metadata.geometryType, 'esriGeometryPolygon');
  assert.equal(metadata.fields.find(f => f.name === 'YEAR_')?.type, 'esriFieldTypeSmallInteger');
  assert.equal(metadata.fields.find(f => f.name === 'GIS_ACRES')?.type, 'esriFieldTypeSingle');
  for (const spec of [FIRE_YEAR, FIRE_ACRES]) {
    const result = renderers.validate(spec.layers[0].renderer, { fields: metadata.fields, geometryType: metadata.geometryType });
    assert.equal(result.valid, true, JSON.stringify(result.issues));
  }
  const count = await get('/query', { f:'json', where:FIRE_WHERE, returnCountOnly:'true' });
  assert.ok(count.count > 0, 'the service accepted the filter and returned features');
});
