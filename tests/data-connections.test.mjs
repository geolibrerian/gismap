import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionRegistry, connectionUrl, discoverOgcCollections } from '../js/data-connections.js';
import { DuckDBBrowserClient } from '../js/duckdb-client.js';

function memoryStorage() { const values = new Map(); return { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), values }; }

test('connection registry persists only allowlisted non-secret settings', () => {
  const storage = memoryStorage(); const registry = new ConnectionRegistry(storage);
  const saved = registry.save({ id: 'one', name: '  Agency ', type: 'postgis-http', config: { url: 'https://agency.example/api', workspace: 'Main', token: 'secret', password: 'secret' }, token: 'secret' });
  assert.equal(saved.name, 'Agency'); assert.equal(registry.list()[0].config.workspace, 'Main');
  assert.ok(![...storage.values.values()].join('').includes('secret'));
  registry.save({ id: 'one', name: 'Changed', type: 'postgis-http', config: { url: 'https://agency.example/api' } });
  assert.equal(registry.list().length, 1); assert.equal(registry.list()[0].name, 'Changed');
  registry.remove('one'); assert.equal(registry.list().length, 0);
  for (const url of ['http://agency.example', 'https://user:pass@agency.example/', 'https://agency.example/?secret=x', 'javascript:alert(1)']) assert.throws(() => connectionUrl(url));
});

test('OGC discovery tests the actual collections endpoint, handles auth and fails closed', async () => {
  let seen;
  const result = await discoverOgcCollections('https://agency.example/api', { token: 'in-memory', fetchImpl: async (url, options) => { seen = {url, options}; return Response.json({collections:[{id:'one',title:'Roads'}]}); } });
  assert.equal(seen.url, 'https://agency.example/api/collections');
  assert.equal(seen.options.headers.Authorization, 'Bearer in-memory');
  assert.equal(seen.options.redirect, 'error');
  assert.equal(result[0].title, 'Roads');
  await assert.rejects(discoverOgcCollections('https://agency.example', { fetchImpl: async () => new Response('', {status:401}) }), /Authentication/);
  await assert.rejects(discoverOgcCollections('https://agency.example', { fetchImpl: async () => Response.json({hello:'world'}) }), /not a supported/);
  await assert.rejects(discoverOgcCollections('https://agency.example', { fetchImpl: async () => { throw new TypeError(); } }), /CORS/);
});

test('DuckDB local import uses generated statements and limits inspection', async () => {
  const client = new DuckDBBrowserClient(); const statements = []; let buffer;
  client.db = { registerFileBuffer: async (_name, data) => { buffer = data; }, dropFile: async () => {} };
  client.connection = { query: async (sql) => { statements.push(sql); return {toArray: () => []}; } };
  const file = {name:'points.csv', size: 5, arrayBuffer: async () => new TextEncoder().encode('x\n1\n').buffer};
  await client.importLocalFile(file, 'points'); await client.inspectRelation('points', 9999);
  assert.ok(buffer instanceof Uint8Array); assert.match(statements[0], /CREATE OR REPLACE TEMP VIEW "points" AS SELECT \* FROM read_csv_auto/);
  assert.ok(statements.some((sql) => /LIMIT 200/.test(sql)));
  await assert.rejects(client.inspectRelation('unloaded'), /not loaded/);
  await assert.rejects(client.importLocalFile({...file, name:'test.zip'}, 'points'), /Choose/);
  await assert.rejects(client.importLocalFile({...file, size: 201 * 1024 * 1024}, 'points'), /200 MB/);
  await assert.rejects(client.importLocalFile(file, 'x;DROP TABLE x'), /Invalid catalog identifier/);
});
