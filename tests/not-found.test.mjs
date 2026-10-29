import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DESTINATIONS, suggestDestinations } from '../js/not-found.js';

const file = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
test('common skill spellings redirect to the canonical skill page', async () => {
  const redirects = await file('_redirects');
  assert.match(redirects, /^\/skill \/skills\/ 301$/m);
  assert.match(redirects, /^\/skill\/ \/skills\/ 301$/m);
  assert.ok(await file('skills/index.html'));
});

test('missing URLs use the 404 page and retain proper not-found handling', async () => {
  const config = JSON.parse(await file('wrangler.json'));
  assert.equal(config.assets.not_found_handling, '404-page');
  const html = await file('404.html');
  assert.match(html, /Here be dragons/);
  // Served for any missing address and possibly in a subfolder: links are relative
  // to the app folder, which the page finds (its manifest) and sets as <base>.
  assert.match(html, /manifest\.webmanifest[\s\S]*document\.createElement\("base"\)/);
  assert.ok(html.indexOf('createElement("base")') < html.indexOf('rel="stylesheet"'), "the base is set before any link loads");
  assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)/, "no links from the server root");
  assert.match(html, /rel="icon" href="assets\/gis-map-online-mark-v2\.png" type="image\/png"/);
  assert.match(html, /href="\.\/"/);
  assert.match(await file("css/dragon-game.css"), /prefers-reduced-motion/);
  assert.match(html, /id="canvas"/);
  assert.match(html, /id="pauseButton"/);
  assert.match(html, /name="robots" content="noindex"/);
  for (const { path } of DESTINATIONS) assert.ok(await file(`${path}index.html`), path);
});

test('suggestions match misspellings without creating untrusted links', () => {
  assert.equal(suggestDestinations('/skils')[0].path, 'skills/');
  assert.equal(suggestDestinations('/guids')[0].path, 'guides/');
  assert.equal(suggestDestinations('/exampels')[0].path, 'examples/');
  assert.deepEqual(suggestDestinations('/zzzzzzzzzzz'), []);
  assert.ok(suggestDestinations('/<script>alert(1)</script>').every(({ path }) => DESTINATIONS.some((known) => known.path === path)));
  assert.ok(suggestDestinations('/' + 'x'.repeat(100000)).length === 0);
});
