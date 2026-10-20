import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CORN_SPEC, CORN_LINK, CORN_URL } from '../scripts/agent-docs.mjs';
import { validateMapSpec } from '../js/map-spec.js';
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('AI ArcGIS guide contains a valid and reproducible linked map', async () => {
  const html = await read('ai-arcgis-map-generator/index.html');
  assert.equal(validateMapSpec(CORN_SPEC).valid, true);
  assert.deepEqual(JSON.parse(decodeURIComponent(new URL(CORN_LINK).hash.slice('#map=json:'.length))), CORN_SPEC);
  assert.ok(html.includes(CORN_LINK)); assert.ok(html.includes(CORN_URL));
  assert.match(html, /CORN_SALES_IN_DOLLARS/); assert.match(html, /Not Disclosed/);
  assert.match(html, /rel="canonical" href="https:\/\/gismap.online\/ai-arcgis-map-generator\//);
  assert.match(html, /application\/ld\+json/); assert.match(html, /rel="describedby"/);
});
test('discovery links point at the generated guide', async () => {
  for (const file of ['index.html','arcgis-feature-service-viewer/index.html','skills/index.html','examples/index.html','guides/ai-agents/index.html','llms.txt','llms-full.txt','sitemap.xml','api/capabilities.json','api/manifest.json']) {
    assert.match(await read(file), /\/ai-arcgis-map-generator\//, file);
  }
});
