import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionRegistry, connectionUrl, discoverOgcCollections, filterOgcCollections, inspectOgcSpatial } from '../js/data-connections.js';
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

test('PostGIS connectors permit HTTP only on loopback and keep credentials out of URLs', async () => {
  const registry = new ConnectionRegistry(memoryStorage());
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    const endpoint = `http://${host}:5435/api`;
    const saved = registry.save({ id: host, type: 'postgis-http', name: host, config: { url: endpoint } });
    assert.equal(saved.config.url, endpoint);
    let requested;
    const entries = await discoverOgcCollections(saved.config.url, { fetchImpl: async (url) => { requested = url; return Response.json({ collections: [{ id: 'local' }] }); } });
    assert.equal(requested, `${endpoint}/collections`);
    assert.equal(entries[0].id, 'local');
  }
  for (const url of ['http://remote.example/', 'http://localhost.example/', 'http://127.0.0.1.example/', 'http://user:password@localhost/', 'http://localhost/?token=secret', 'http://localhost/#secret']) {
    assert.throws(() => connectionUrl(url, { allowLoopbackHttp: true }));
  }
  assert.throws(() => connectionUrl('http://localhost:5435/'));
  assert.throws(() => registry.save({ id: 'remote', type: 'postgis-http', name: 'Remote', config: { url: 'http://remote.example/' } }));
  assert.throws(() => registry.save({ id: 'file', type: 'duckdb-remote-file', name: 'File', config: { url: 'http://localhost/file.parquet' } }));
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

test('collection search and sorting use labels, ids and descriptions without mutating the list', () => {
  const entries = [{ id: 'a.roads', title: 'Roads', description: 'Streets', spatialStatus: 'spatial' }, { id: 'b.places', title: 'Places', description: '', spatialStatus: 'unknown' }];
  assert.deepEqual(filterOgcCollections(entries).map((e) => e.title), ['Places', 'Roads']);
  assert.deepEqual(filterOgcCollections(entries, { sort: 'desc' }).map((e) => e.title), ['Roads', 'Places']);
  assert.deepEqual(filterOgcCollections(entries, { search: 'STREETS', spatial: 'spatial' }).map((e) => e.id), ['a.roads']);
  assert.equal(filterOgcCollections(entries, { search: 'b.places' })[0].title, 'Places');
  assert.deepEqual(entries.map((e) => e.title), ['Roads', 'Places']);
});

test('spatial inspection samples a same-origin collection and does not guess about empty data', async () => {
  let request;
  const spatial = await inspectOgcSpatial('http://localhost:9000/collections', '../places', { token: 'session', fetchImpl: async (url, options) => { request = { url, options }; return Response.json({ type: 'FeatureCollection', features: [{ type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] } }] }); } });
  assert.equal(request.url, 'http://localhost:9000/collections/..%2Fplaces/items?limit=1');
  assert.equal(request.options.headers.Authorization, 'Bearer session'); assert.equal(request.options.redirect, 'error');
  assert.deepEqual(spatial, { status: 'spatial', geometryType: 'Point' });
  for (const features of [[], [{ type: 'Feature', geometry: null }]]) {
    const result = await inspectOgcSpatial('https://example.com', 'table', { fetchImpl: async () => Response.json({ type: 'FeatureCollection', features }) });
    assert.equal(result.status, 'unknown');
  }
  await assert.rejects(inspectOgcSpatial('https://example.com', 'table', { fetchImpl: async () => new Response('', { status: 403 }) }), /403/);
  await assert.rejects(inspectOgcSpatial('https://example.com', 'table', { fetchImpl: async () => Response.json({ features: [] }) }), /GeoJSON/);
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
