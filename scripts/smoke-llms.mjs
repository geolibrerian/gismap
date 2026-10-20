// Validate the deployed HTTP response, not just the source files. No browser or dependencies required.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';

export async function smokeLlms(base, { matchLocal = false, fetcher = fetch } = {}) {
  const origin = new URL(base);
  if (!['https:', 'http:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Supply a deployment origin such as https://preview.example.pages.dev');
  const request = async path => {
    const response = await fetcher(new URL(path, origin), { redirect: 'manual', signal: AbortSignal.timeout(30000), headers: { Accept: 'text/plain' } });
    const content = await response.text();
    console.log(`${path}: HTTP ${response.status}; Content-Type: ${response.headers.get('content-type') || '(missing)'}; CF-Cache-Status: ${response.headers.get('cf-cache-status') || '(not reported)'}`);
    return { response, content };
  };
  for (const path of ['/llms.txt', '/llms-full.txt']) {
    const { response, content } = await request(path);
    assert.equal(response.status, 200, `${path} must be served directly`);
    assert.match(response.headers.get('content-type') || '', /^text\/plain\s*;\s*charset\s*=\s*utf-8\s*$/i, `${path} must be UTF-8 plain text`);
    assert.match(content, /^# GIS Map Online\r?\n/, `${path} must start with the GISMap heading`);
    assert.doesNotMatch(content, /^\s*(?:<!doctype\s+html|<html\b)/i, `${path} must not be an HTML fallback`);
    for (const reference of ['/schemas/map-v1.schema.json', '/api/capabilities.json', '/skills/']) assert.ok(content.includes(reference), `${path} is missing ${reference}`);
    if (matchLocal) assert.equal(content, await readFile(new URL(`..${path}`, import.meta.url), 'utf8'), `${path} differs from the checked-out deployment artifact (stale cache or wrong deployment)`);
  }
  const alias = await request('/llm.txt');
  assert.equal(alias.response.status, 301, 'The singular alias must be a permanent 301');
  assert.equal(new URL(alias.response.headers.get('location') || '', origin).href, new URL('/llms.txt', origin).href, 'The alias must point to the canonical endpoint on the same origin');
  const missing = await request('/__gismap_nonexistent_documentation_smoke_test__.txt');
  assert.equal(missing.response.status, 404, 'Missing documents must return a real 404');
  console.log('Documentation smoke test passed.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const base = process.argv[2];
  if (!base) { console.error('Usage: node scripts/smoke-llms.mjs https://deployment.example [--match-local]'); process.exitCode = 2; }
  else smokeLlms(base, { matchLocal: process.argv.includes('--match-local') }).catch(error => { console.error(`Documentation smoke test failed: ${error.message}`); process.exitCode = 1; });
}
