// The existing GISMap dialog is dockable on desktop and a sheet on mobile.
// These panels never serialize runtime objects, file contents, or credentials.
import { ConnectionRegistry, connectionUrl, discoverOgcCollections, filterOgcCollections, inspectOgcSpatial } from './data-connections.js?v=0.54.0-collections1';
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
    <div class="connection-actions"><button class="button button--primary" type="button" data-connection-test>Test and browse</button> <button class="button" type="button" data-connection-save>Save connection</button> <button class="button" type="button" data-connection-remove>Remove</button></div>
    <p class="form-note" role="status" data-connection-status>Not connected.</p><div data-connection-results></div>` });
  const list = field('saved');
  let generation = 0;
  const clearResults = () => { generation++; field('results').replaceChildren(); };
  function refresh(selected = '') {
    list.replaceChildren(new Option('New connection', ''));
    for (const item of registry().list().filter((entry) => entry.type === 'postgis-http')) list.add(new Option(item.name, item.id));
    list.value = selected;
  }
  refresh();
  list.addEventListener('change', () => {
    const item = registry().list().find((entry) => entry.id === list.value);
    field('name').value = item?.name || ''; field('url').value = item?.config?.url || ''; field('workspace').value = item?.config?.workspace || '';
    field('token').value = ''; clearResults(); status('Not connected.');
  });
  field('url').addEventListener('input', () => { clearResults(); status('Endpoint changed. Test the connection to browse collections.'); });
  field('token').addEventListener('input', () => { clearResults(); status('Authentication changed. Test the connection to browse collections.'); });
  bind('save', () => {
    const item = registry().save({ id: list.value || undefined, type: 'postgis-http', name: field('name').value, config: { url: connectionUrl(field('url').value, { allowLoopbackHttp: true }), workspace: field('workspace').value } });
    refresh(item.id); status('Connection settings saved locally. No connection has been tested.');
  });
  bind('remove', () => { if (!list.value) throw new Error('Select a saved connection to remove.'); registry().remove(list.value); refresh(); field('name').value = ''; field('url').value = ''; field('workspace').value = ''; field('token').value = ''; clearResults(); status('Connection removed.'); });
  bind('test', async () => {
    clearResults(); const current = generation; status('Checking the connector…');
    const endpoint = field('url').value; const token = field('token').value.trim();
    const entries = (await discoverOgcCollections(endpoint, { token })).map((entry) => ({ ...entry, spatialStatus: 'unknown' }));
    if (current !== generation) return;
    status(`Loaded ${entries.length} collections. Adding collections to the map is not yet supported.`);
    const results = field('results');
    results.innerHTML = `<section class="connection-browser" aria-label="Browse collections">
      <h3>Browse collections</h3>
      <div class="connection-browser__controls">
        <label class="field"><span>Search collections</span><input type="search" data-collection-search placeholder="Search name or description"></label>
        <label class="field"><span>Sort by name</span><select data-collection-sort><option value="asc">A to Z</option><option value="desc">Z to A</option></select></label>
        <label class="field"><span>Spatial status</span><select data-collection-filter><option value="all">All collections</option><option value="spatial">Spatial</option><option value="unknown">Not checked / unknown</option></select></label>
      </div>
      <p class="form-note">Check collections for geometry in a sample feature. Empty collections or features without geometry remain unknown. The connector may paginate its collection list.</p>
      <button class="button" type="button" data-collection-check-visible>Check visible for spatial data</button>
      <p class="form-note" data-collection-count aria-live="polite"></p><ul class="connection-browser__list" data-collection-list></ul></section>`;
    const search = results.querySelector('[data-collection-search]');
    const sort = results.querySelector('[data-collection-sort]');
    const filter = results.querySelector('[data-collection-filter]');
    const collectionList = results.querySelector('[data-collection-list]');
    const checkVisible = results.querySelector('[data-collection-check-visible]');
    const inspect = async (entry) => {
      entry.checking = true; entry.inspectionMessage = ''; render();
      try {
        const result = await inspectOgcSpatial(endpoint, entry.id, { token });
        entry.spatialStatus = result.status; entry.geometryType = result.geometryType;
        if (result.status === 'unknown') entry.inspectionMessage = 'No geometry in the sample; spatial status is still unknown.';
      } catch (error) { entry.inspectionMessage = error?.message || 'Inspection failed.'; }
      finally { entry.checking = false; if (current === generation && results.isConnected) render(); }
    };
    const render = () => {
      const visible = filterOgcCollections(entries, { search: search.value, sort: sort.value, spatial: filter.value });
      results.querySelector('[data-collection-count]').textContent = `Showing ${visible.length} of ${entries.length} loaded collections`;
      collectionList.replaceChildren();
      for (const entry of visible) {
        const li = document.createElement('li'); li.className = 'connection-browser__item';
        const info = document.createElement('div'); info.className = 'connection-browser__info';
        const name = document.createElement('strong'); name.textContent = entry.title; info.append(name);
        if (entry.title !== entry.id) { const id = document.createElement('small'); id.textContent = entry.id; info.append(id); }
        if (entry.description) { const desc = document.createElement('small'); desc.textContent = entry.description; info.append(desc); }
        const badge = document.createElement('small'); badge.className = 'connection-browser__badge';
        badge.textContent = entry.spatialStatus === 'spatial' ? `Spatial · ${entry.geometryType}` : 'Spatial status unknown'; info.append(badge);
        if (entry.inspectionMessage) { const note = document.createElement('small'); note.textContent = entry.inspectionMessage; info.append(note); }
        const check = document.createElement('button'); check.className = 'button'; check.type = 'button';
        check.textContent = entry.checking ? 'Checking…' : 'Check spatial'; check.disabled = !!entry.checking;
        check.setAttribute('aria-label', `Check spatial status of ${entry.title}`);
        check.addEventListener('click', () => inspect(entry));
        li.append(info, check); collectionList.append(li);
      }
      if (!visible.length) { const li = document.createElement('li'); li.className = 'connection-browser__empty'; li.textContent = 'No collections match these filters.'; collectionList.append(li); }
    };
    checkVisible.addEventListener('click', async () => {
      const targets = filterOgcCollections(entries, { search: search.value, sort: sort.value, spatial: filter.value }).filter((entry) => !entry.checking);
      checkVisible.disabled = true;
      try {
        for (let i = 0; i < targets.length && current === generation && results.isConnected; i++) {
          checkVisible.textContent = `Checking ${i + 1} of ${targets.length}…`;
          if (!targets[i].checking) await inspect(targets[i]);
        }
      } finally { checkVisible.disabled = false; checkVisible.textContent = 'Check visible for spatial data'; }
    });
    search.addEventListener('input', render); sort.addEventListener('change', render); filter.addEventListener('change', render); render();
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
