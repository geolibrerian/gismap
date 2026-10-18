// Persist only explicit, non-secret connection metadata. Runtime sessions and
// credentials never enter this registry or a GISMap project/share document.
const KEY = 'gismap-online:data-connections:v1';
const TYPES = new Set(['duckdb-wasm', 'duckdb-remote-file', 'postgis-http', 'pmtiles']);

export function connectionUrl(value, { allowLoopbackHttp = false } = {}) {
  let url;
  try { url = new URL(String(value || '').trim()); } catch { throw new Error('Enter a valid connector URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(allowLoopbackHttp && url.protocol === 'http:' && loopback)) || url.username || url.password) {
    throw new Error(allowLoopbackHttp
      ? 'Use HTTPS or HTTP on localhost, 127.0.0.1, or [::1], without a username or password.'
      : 'Use an HTTPS URL without a username or password.');
  }
  // A conservative boundary: query parameters may contain provider secrets.
  if (url.search || url.hash) throw new Error('Connection URLs cannot contain query parameters or fragments; use session authentication instead.');
  return url.href;
}

export class ConnectionRegistry {
  constructor(storage = globalThis.localStorage) { this.storage = storage; }
  list() {
    try {
      const entries = JSON.parse(this.storage?.getItem(KEY) || '[]');
      return Array.isArray(entries) ? entries.filter((x) => x && TYPES.has(x.type) && typeof x.id === 'string') : [];
    } catch { return []; }
  }
  save(input) {
    if (!TYPES.has(input.type)) throw new Error('Unsupported connection type.');
    const name = String(input.name || '').trim().slice(0, 120);
    if (!name) throw new Error('Enter a connection name.');
    const id = String(input.id || globalThis.crypto.randomUUID());
    const config = {};
    if (input.config?.url) config.url = connectionUrl(input.config.url, { allowLoopbackHttp: input.type === 'postgis-http' });
    if (input.type === 'postgis-http') config.workspace = String(input.config?.workspace || '').trim().slice(0, 120);
    const record = { id, name, type: input.type, config };
    const entries = this.list().filter((entry) => entry.id !== id);
    entries.push(record);
    this.storage.setItem(KEY, JSON.stringify(entries));
    return record;
  }
  remove(id) { this.storage.setItem(KEY, JSON.stringify(this.list().filter((entry) => entry.id !== id))); }
}

// OGC API Features collection discovery, not a direct PostgreSQL connection.
// Tokens are accepted only in memory and only sent to the configured origin.
function collectionsUrl(endpoint) {
  const base = new URL(connectionUrl(endpoint, { allowLoopbackHttp: true }));
  return base.pathname.replace(/\/$/, '').endsWith('/collections')
    ? base : new URL(`${base.href.replace(/\/$/, '')}/collections`);
}

export async function discoverOgcCollections(endpoint, { token = '', fetchImpl = fetch, signal } = {}) {
  const collections = collectionsUrl(endpoint);
  let response;
  try {
    response = await fetchImpl(collections.href, { headers: { Accept: 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal, redirect: 'error' });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('The connector could not be reached. Check the address, CORS, browser local-network permissions, and redirects. A PostgreSQL port is not an HTTP connector.');
  }
  if (response.status === 401) throw new Error('Authentication required or credentials rejected (HTTP 401).');
  if (response.status === 403) throw new Error('The connector denied access (HTTP 403).');
  if (!response.ok) throw new Error(`The connector returned HTTP ${response.status}.`);
  let data;
  try { data = await response.json(); } catch { throw new Error('The connector did not return JSON.'); }
  if (!Array.isArray(data?.collections)) throw new Error('The endpoint is reachable but is not a supported OGC API Features collections endpoint.');
  return data.collections.filter((item) => typeof item?.id === 'string').map((item) => ({
    id: item.id, title: String(item.title || item.id), description: String(item.description || ''),
    extent: item.extent || null, crs: Array.isArray(item.crs) ? item.crs.filter((v) => typeof v === 'string') : [],
  }));
}

// An extent alone is not proof that a collection actually contains geometry.
// Sample only on explicit request, and never treat an empty/null sample as non-spatial.
export async function inspectOgcSpatial(endpoint, id, { token = '', fetchImpl = fetch, signal } = {}) {
  const base = collectionsUrl(endpoint).href.replace(/\/$/, '');
  if (id === '.' || id === '..') throw new Error('This collection ID cannot be inspected safely.');
  const url = `${base}/${encodeURIComponent(id)}/items?limit=1`;
  let response;
  try {
    response = await fetchImpl(url, { headers: { Accept: 'application/geo+json, application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, signal, redirect: 'error' });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new Error('Could not inspect this collection. Check CORS and connector access.');
  }
  if (!response.ok) throw new Error(`Collection inspection failed (HTTP ${response.status}).`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Collection inspection did not return JSON.'); }
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error('The connector did not return a GeoJSON feature collection.');
  const geometry = data.features.find((feature) => feature?.type === 'Feature' && feature.geometry && typeof feature.geometry.type === 'string')?.geometry;
  return geometry ? { status: 'spatial', geometryType: geometry.type } : { status: 'unknown', geometryType: null };
}

export function filterOgcCollections(entries, { search = '', sort = 'asc', spatial = 'all' } = {}) {
  const query = search.trim().toLocaleLowerCase();
  return entries.filter((entry) => (!query || `${entry.title} ${entry.id} ${entry.description}`.toLocaleLowerCase().includes(query)) && (spatial === 'all' || entry.spatialStatus === spatial))
    .slice().sort((a, b) => (sort === 'desc' ? -1 : 1) * (a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' }) || a.id.localeCompare(b.id)));
}
