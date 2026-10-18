// The existing GISMap dialog is dockable on desktop and a sheet on mobile.
// These panels never serialize runtime objects, file contents, or credentials.
import { ConnectionRegistry, connectionUrl, discoverOgcCollections } from './data-connections.js?v=0.54.0-localhost1';
import { inspectExternalTiles } from './engines/maplibre/external-tiles.js?v=0.54.0';

const registry = () => new ConnectionRegistry();
const field = (name) => document.querySelector(`[data-connection-${name}]`);
const status = (message) => { const node = field('status'); if (node) node.textContent = message; };
const bind = (name, fn) => field(name)?.addEventListener('click', async (event) => {
  const button = event.currentTarget;
  button.disabled = true;
  try { await fn(); } catch (error) { status(error?.message || 'The operation failed.'); }
  finally { button.disabled = false; }
});

export function openPostgisPanel(ui) {
  ui.openDialog({ eyebrow: 'Data connections', title: 'Connect PostGIS', content: `
    <p class="form-note">Connect through an OGC API Features HTTP service. Remote services require HTTPS; HTTP is also allowed on localhost, 127.0.0.1, or [::1]. Browsers cannot connect directly to a PostgreSQL port. The service must allow CORS from GISMap Online. A successful discovery does not verify the underlying database.</p>
    <label class="field"><span>Saved connections</span><select data-connection-saved><option value="">New connection</option></select></label>
    <label class="field"><span>Connection name</span><input data-connection-name autocomplete="off"></label>
    <label class="field"><span>Connector endpoint (HTTPS or local HTTP)</span><input data-connection-url type="url" autocomplete="url"></label>
    <label class="field"><span>Workspace or database display name (optional)</span><input data-connection-workspace></label>
    <label class="field"><span>Session bearer token (optional, never saved)</span><input data-connection-token type="password" autocomplete="off"></label>
    <div><button type="button" data-connection-test>Test and browse</button> <button type="button" data-connection-save>Save connection</button> <button type="button" data-connection-remove>Remove</button></div>
    <p class="form-note" role="status" data-connection-status>Not connected.</p><div data-connection-results></div>` });
  const list = field('saved');
  function refresh(selected = '') {
    list.replaceChildren(new Option('New connection', ''));
    for (const item of registry().list().filter((entry) => entry.type === 'postgis-http')) list.add(new Option(item.name, item.id));
    list.value = selected;
  }
  refresh();
  list.addEventListener('change', () => {
    const item = registry().list().find((entry) => entry.id === list.value);
    field('name').value = item?.name || ''; field('url').value = item?.config?.url || ''; field('workspace').value = item?.config?.workspace || '';
    field('token').value = ''; field('results').replaceChildren(); status('Not connected.');
  });
  bind('save', () => {
    const item = registry().save({ id: list.value || undefined, type: 'postgis-http', name: field('name').value, config: { url: connectionUrl(field('url').value, { allowLoopbackHttp: true }), workspace: field('workspace').value } });
    refresh(item.id); status('Connection settings saved locally. No connection has been tested.');
  });
  bind('remove', () => { if (!list.value) throw new Error('Select a saved connection to remove.'); registry().remove(list.value); refresh(); field('name').value = ''; field('url').value = ''; field('workspace').value = ''; field('token').value = ''; field('results').replaceChildren(); status('Connection removed.'); });
  bind('test', async () => {
    field('results').replaceChildren(); status('Checking the connector…');
    const entries = await discoverOgcCollections(field('url').value, { token: field('token').value.trim() });
    const ul = document.createElement('ul');
    for (const entry of entries) { const li = document.createElement('li'); li.textContent = `${entry.title} (${entry.id})`; ul.append(li); }
    field('results').append(ul);
    status(`OGC API Features collections discovered: ${entries.length}. Adding collections to the map is not yet supported here.`);
  });
}

export function openDuckdbPanel(ui, client) {
  ui.openDialog({ eyebrow: 'Data connections', title: 'Connect DuckDB', content: `
    <p class="form-note">DuckDB-Wasm runs in a worker on this device. Files are not uploaded. Local data must be re-imported after a reload. Large files may exhaust browser memory, especially on mobile.</p>
    <div><button type="button" data-connection-start>Start DuckDB</button> <button type="button" data-connection-stop>Stop</button> <button type="button" data-connection-spatial>Check spatial extension</button></div>
    <label class="field"><span>Local CSV, JSON, Parquet or GeoParquet</span><input type="file" data-connection-file accept=".csv,.json,.geojson,.parquet,.geoparquet"></label>
    <label class="field"><span>Table name</span><input data-connection-name value="local_data" autocomplete="off"></label>
    <div><button type="button" data-connection-import>Import and preview</button></div>
    <label class="field"><span>Remote Parquet / GeoParquet HTTPS URL</span><input type="url" data-connection-url placeholder="https://example.com/data.parquet"></label>
    <div><button type="button" data-connection-remote>Load remote Parquet and preview</button></div>
    <p class="form-note" role="status" data-connection-status>Stopped. DuckDB is loaded only when started.</p>
    <pre data-connection-results style="max-height:18rem;overflow:auto;white-space:pre-wrap"></pre>
    <p class="form-note">Remote Parquet requires provider CORS and may require HTTP ranges. Spatial rendering, SQL editing, and remote DuckDB services are not yet available in this panel.</p>` });
  status(client.connection ? 'Ready: browser DuckDB is running.' : 'Stopped. DuckDB is loaded only when started.');
  bind('start', async () => { status('Starting DuckDB locally…'); await client.initialize(); status('Ready: browser DuckDB is running.'); });
  bind('stop', async () => { if (client.initializing) throw new Error('Wait for initialization to finish before stopping.'); await client.close(); field('results').textContent = ''; status('Stopped; in-memory tables were cleared.'); });
  bind('spatial', async () => { status('Checking the DuckDB spatial extension…'); await client.checkSpatial(); status('DuckDB spatial extension loaded successfully. Mapping spatial results is not yet supported here.'); });
  bind('import', async () => {
    const file = field('file').files?.[0]; if (!file) throw new Error('Select a local file first.');
    status(`Importing ${file.name} locally…`);
    const name = await client.importLocalFile(file, field('name').value.trim());
    const { schema, rows } = await client.inspectRelation(name);
    field('results').textContent = JSON.stringify({ schema, rows }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
    status(`Loaded ${name}. Showing up to 50 records; dataset contents stay in this browser.`);
  });
  bind('remote', async () => {
    const url = connectionUrl(field('url').value);
    const name = field('name').value.trim();
    status('Loading remote Parquet; the provider must allow browser access…');
    await client.loadCatalog({ relations: [{ name, source: { format: 'parquet', url } }] }, () => []);
    const { schema, rows } = await client.inspectRelation(name);
    field('results').textContent = JSON.stringify({ schema, rows }, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2);
    status(`Loaded ${name} from the remote file. Showing up to 50 records.`);
  });
}

export function openPmtilesPanel(ui, mapController, switchEngine) {
  const available = mapController.getEngineId() === 'maplibre';
  ui.openDialog({ eyebrow: 'Tiled data', title: 'Add PMTiles', content: `
    <p class="form-note">${available ? 'Inspect a public HTTPS PMTiles archive. The host must allow CORS and HTTP byte ranges.' : 'PMTiles requires MapLibre; the ArcGIS adapter does not currently support it.'}</p>
    ${available ? '<label class="field"><span>Archive URL</span><input type="url" data-connection-url placeholder="https://example.com/data.pmtiles"></label><button type="button" data-connection-test>Inspect archive</button><p class="form-note" role="status" data-connection-status>Not inspected.</p><pre data-connection-results style="max-height:18rem;overflow:auto;white-space:pre-wrap"></pre><p class="form-note">Archive rendering, layer management, and share restoration are not implemented yet.</p>' : '<button type="button" data-connection-switch>Switch to MapLibre</button><p class="form-note" role="status" data-connection-status>Other layers and view are preserved where supported.</p>'}` });
  bind('switch', () => switchEngine('maplibre'));
  bind('test', async () => {
    status('Inspecting archive…');
    const result = await inspectExternalTiles(field('url').value, { type: 'pmtiles', maplibre: globalThis.maplibregl });
    const summary = { ...result, layers: result.layers.map(({ id, fields }) => ({ id, fieldCount: fields.length, sampleFields: fields.slice(0, 12) })) };
    field('results').textContent = JSON.stringify(summary, null, 2);
    status(`Archive inspected: ${result.kind} tiles. This does not add a layer to the map.`);
  });
}
