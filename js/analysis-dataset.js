// Session-only description of what can actually be queried, not a map spec or
// a guarantee that the original source has not changed since it was loaded.
export function createAnalysisDataset({ layer, config = {}, relation, geometry, coverage, freshness }) {
  if (!layer?.uid || !relation) throw new Error('A layer and session relation are required.');
  return {
    version: 1,
    layerId: layer.uid,
    title: layer.title || 'Untitled layer',
    relation,
    source: { format: String(config.sourceType || 'unknown'), location: config.local ? 'local' : 'remote' },
    fields: (layer.fields || []).map(({ name, type }) => ({ name, type: type || 'unknown' })),
    identity: { field: layer.objectIdField || null, scope: layer.objectIdField ? 'loaded-layer' : 'unknown' },
    geometry: { field: geometry?.field || null, encoding: geometry?.encoding || 'unknown', types: [...new Set(geometry?.types || [])], crs: geometry?.crs || 'unknown', crsStatus: geometry?.crsStatus || 'unknown' },
    coverage: { scope: coverage?.scope || 'unknown', status: coverage?.status || 'unverified', count: Number.isFinite(coverage?.count) ? coverage.count : null, total: Number.isFinite(coverage?.total) ? coverage.total : null },
    freshness: { kind: freshness?.kind || 'unknown', preparedAt: freshness?.preparedAt || null, versionPinned: false },
  };
}

export function describeAnalysisDataset(dataset) {
  const c = dataset.coverage;
  const coverage = c.scope === 'source' ? 'Source relation (not the map preview)' : c.status === 'complete' ? 'Complete loaded-layer snapshot according to the layer count' : c.status === 'partial' ? 'Partial loaded-layer snapshot' : 'Loaded-layer snapshot; completeness unverified';
  const count = c.count == null ? '' : `; ${c.count.toLocaleString()}${c.total == null ? '' : ` of ${c.total.toLocaleString()}`} rows`;
  const types = dataset.geometry.types.length ? dataset.geometry.types.join(', ') : 'unknown';
  const crs = dataset.geometry.crsStatus === 'known' ? dataset.geometry.crs : `${dataset.geometry.crs} (not independently verified)`;
  const freshness = dataset.freshness.kind === 'snapshot' ? 'Session snapshot; later layer changes are not reflected.' : 'Source relation; source may change and is not version-pinned.';
  return `${coverage}${count}. ${dataset.source.location} ${dataset.source.format}; geometry: ${types}; CRS: ${crs}. ${freshness}`;
}

/** Remove only relations owned by map layers; leave independent SQL datasets alone. */
export function releaseLayerAnalysis(runtime, uid = null) {
  if (uid == null) runtime.analysisEpoch = (runtime.analysisEpoch || 0) + 1;
  const maps = [runtime.geoParquetLayers, runtime.analysisLayers].filter(Boolean);
  const relations = new Set();
  for (const map of maps) {
    for (const [key, entry] of map) if (uid == null || key === uid) { if (entry?.relation) relations.add(entry.relation); map.delete(key); }
  }
  for (const name of relations) void runtime.duckdb.removeRelation(name).catch(() => {});
}
