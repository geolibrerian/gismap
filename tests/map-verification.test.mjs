import test from 'node:test';
import assert from 'node:assert/strict';
import { mapSpec, renderers } from '../js/gismap-core.js';
import { createMapSpecApi } from '../js/map-spec-api.js';

import { MICHIGAN_SPEC as michigan, MICHIGAN_LINK } from '../scripts/agent-docs.mjs';
const source = michigan.layers[0].url;

test('offline verification reports unperformed checks and round-trips the normalized spec', async () => {
  const report = await mapSpec.prepareVerification(michigan);
  assert.equal(report.status, 'validated');
  assert.equal(report.checks.linkRoundTrip, 'passed');
  for (const key of ['sourceMetadata','fields','filterAccepted','layerLoaded','mapRendered','shareLinkReopened']) assert.equal(report.checks[key], 'not_checked');
  const decoded = await mapSpec.decode(new URL(report.url).hash.slice(5));
  assert.equal(decoded.layers[0].where, "statecode = '26'");
  assert.deepEqual(await mapSpec.decode(new URL(MICHIGAN_LINK).hash.slice(5)), michigan);
  assert.deepEqual(decoded.camera.center, [-85.5, 44.6]);
  const api = createMapSpecApi({ layers: {}, camera: {}, mapController: {} });
  assert.equal((await api.prepareVerification(michigan)).checks.mapRendered, 'not_checked');
});

test('invalid input produces no misleading link', async () => {
  const report = await mapSpec.prepareVerification({version: 1, layers: [{url: 'https://example.org/', where: '1=1; DROP TABLE x'}]});
  assert.equal(report.status, 'invalid');
  assert.equal(report.url, null);
  assert.ok(report.errors.length);
});

test('live Michigan source and filters (does not substitute for GISMap browser reload)', { skip: process.env.GISMAP_LIVE_TESTS !== '1' }, async () => {
  const get = async (path, params) => {
    const response = await fetch(`${source}${path}?${new URLSearchParams(params)}`);
    assert.equal(response.ok, true);
    const data = await response.json();
    assert.equal(data.error, undefined, JSON.stringify(data.error));
    return data;
  };
  const metadata = await get('', {f:'json'});
  assert.equal(metadata.geometryType, 'esriGeometryPolygon');
  assert.equal(metadata.fields.find(f => f.name === 'statecode')?.type, 'esriFieldTypeString');
  assert.equal(metadata.fields.find(f => f.name === 'v001_rawvalue')?.type, 'esriFieldTypeDouble');
  assert.equal(renderers.validate(michigan.layers[0].renderer, { fields: metadata.fields, geometryType: metadata.geometryType }).valid, true);
  const query = async (where) => (await get('/query', {f:'json', where, returnCountOnly:'true'})).count;
  assert.equal(await query("statecode = '26'"), 83);
  for (const where of ['v001_rawvalue > 0', "statecode = '26' AND v001_rawvalue > 0", "statecode = '26' AND v001_rawvalue IS NULL", "statecode = '26' AND v001_rawvalue IS NOT NULL"]) assert.equal(typeof await query(where), 'number');
});
