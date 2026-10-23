// Bounded, short-lived source queries for timeline previews. Never substitute a
// loaded map sample for a service result or persist remote counts in a project.
import { seriesWhere } from './briefing-data-series.js?v=0.60.0-media1';

export function createTimelineSourceCache({ fetchImpl = globalThis.fetch, ttl = 60000, maxEntries = 128, now = () => Date.now() } = {}) {
  const cache = new Map();
  async function query({ url, filter, fields, baseWhere = '', stat = '', statField = '' }) {
    const source = new URL(url);
    if (!['https:', 'http:'].includes(source.protocol) || !/\/(?:FeatureServer|MapServer)\/\d+\/?$/i.test(source.pathname) || source.username || source.password || source.search || source.hash) throw new Error('Complete-source preview requires a direct ArcGIS feature layer URL without credentials or query parameters.');
    if (stat && (!['sum', 'average', 'min', 'max'].includes(stat) || !fields.some(field => field.name === statField && /^[A-Za-z_][\w.]*$/.test(field.name) && /integer|long|short|double|single|float|number/i.test(field.type || '')))) throw new Error('Choose a numeric statistic field.');
    const where = seriesWhere(filter, fields);
    const params = new URLSearchParams({ f:'json', where: baseWhere ? `(${baseWhere}) AND (${where})` : where, returnGeometry:'false' });
    if (stat) params.set('outStatistics', JSON.stringify([{ statisticType:'count', onStatisticField:filter.field, outStatisticFieldName:'timeline_count' }, { statisticType:stat === 'average' ? 'avg' : stat, onStatisticField:statField, outStatisticFieldName:'timeline_value' }]));
    else params.set('returnCountOnly', 'true');
    const key = `${source.href}|${params}`;
    const hit = cache.get(key);
    if (hit && now() - hit.created < ttl) { cache.delete(key); cache.set(key, hit); return hit.promise; }
    if (hit) cache.delete(key);
    const promise = (async () => {
      const response = await fetchImpl(`${source.href.replace(/\/$/, '')}/query`, { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:params.toString() });
      if (!response.ok) throw new Error(`Source query failed (HTTP ${response.status}).`);
      const json = await response.json();
      if (json.error) throw new Error(json.error.message || 'The service rejected the statistics query.');
      const values = stat ? json.features?.[0]?.attributes : json;
      const count = stat ? values?.timeline_count : values?.count;
      if (!Number.isInteger(count) || count < 0) throw new Error('The service did not return a complete count.');
      const value = stat ? values?.timeline_value ?? null : null;
      if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error('The service returned an invalid statistic.');
      return { count, value };
    })();
    cache.set(key, { created:now(), promise });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    try { return await promise; } catch (error) { if (cache.get(key)?.promise === promise) cache.delete(key); throw error; }
  }
  async function prefetch(requests, { concurrency = 3 } = {}) {
    const output = new Array(requests.length); let next = 0;
    await Promise.all(Array.from({length:Math.min(Math.max(1, concurrency), requests.length)}, async () => {
      while (next < requests.length) { const i = next++; output[i] = await query(requests[i]); }
    }));
    return output;
  }
  return { query, prefetch, clear:() => cache.clear() };
}
