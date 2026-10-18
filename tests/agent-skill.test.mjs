import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mapSpec } from '../js/gismap-core.js';

const skill = new URL('../skills/gismap/', import.meta.url);
const read = (path) => readFileSync(new URL(path, skill), 'utf8');
const check = (path) => spawnSync('python3', [new URL('scripts/validate_map.py', skill).pathname, path], { encoding: 'utf8' });

test('skill metadata and referenced resources are present', () => {
  const markdown = read('SKILL.md');
  assert.match(markdown, /^---\nname: gismap\ndescription: .+\n/);
  for (const [, ref] of markdown.matchAll(/\]\((references\/[^)]+)\)/g)) assert.ok(read(ref));
  const result = spawnSync('python3', ['scripts/build-skill-zip.py', '--check'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('example maps validate and their links round-trip through the real core', async () => {
  for (const name of ['geojson-map.json', 'mlb-ballparks.json', 'philly-police.json']) {
    const path = new URL(`assets/examples/${name}`, skill).pathname;
    const preliminary = check(path);
    assert.equal(preliminary.status, 0, preliminary.stdout);
    const spec = JSON.parse(read(`assets/examples/${name}`));
    const result = mapSpec.validate(spec);
    assert.equal(result.valid, true, JSON.stringify(result.issues));
    const link = await mapSpec.createLink(result.spec);
    const decoded = await mapSpec.decode(new URL(link.url).hash.slice(5));
    assert.deepEqual(decoded.layers, result.spec.layers);
    assert.deepEqual(decoded.camera, result.spec.camera);
    if (result.spec.briefing) assert.deepEqual(decoded.briefing, result.spec.briefing);
  }
});

test('offline checks reject unsafe and invalid inputs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'gismap-skill-'));
  try {
    const path = join(dir, 'bad.json');
    for (const layer of [{url:'https://example.org/data?client_secret=x'}, {url:'http://example.org/data'}, {url:'https://example.org/data', renderer:{type:'fictional'}}, {url:'https://example.org/data', where:'1=1; DROP TABLE x'}]) {
      writeFileSync(path, JSON.stringify({version:1, layers:[layer]}));
      const result = check(path);
      assert.equal(result.status, 1, result.stdout);
      assert.equal(JSON.parse(result.stdout).valid, false);
    }
    writeFileSync(path, '{');
    assert.equal(check(path).status, 2);
  } finally { rmSync(dir, {recursive:true, force:true}); }
});
