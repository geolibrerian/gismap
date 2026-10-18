import test from 'node:test';
import assert from 'node:assert/strict';
import { createAnalysisDataset, describeAnalysisDataset, releaseLayerAnalysis } from '../js/analysis-dataset.js';

const layer = { uid: 'a', title: 'Places', objectIdField: 'oid', fields: [{name:'oid',type:'oid'}] };
test('describes partial snapshots without exposing source URLs or credentials', () => {
  const data = createAnalysisDataset({ layer, config: { local: true, sourceType: 'kml', url: 'https://host/?token=secret' }, relation: 'places', geometry: { field: '__gismap_geometry', encoding: 'geojson-text', types: ['Point','Point'], crs: 'CRS84 requested', crsStatus: 'unverified' }, coverage: {scope: 'loaded-layer', status: 'partial', count: 20, total: 25}, freshness: {kind: 'snapshot', preparedAt: '2026-01-01'} });
  assert.deepEqual(data.geometry.types, ['Point']); assert.equal(data.identity.field, 'oid');
  assert.match(describeAnalysisDataset(data), /Partial loaded-layer snapshot; 20 of 25 rows/);
  assert.match(describeAnalysisDataset(data), /not independently verified/);
  assert.doesNotMatch(JSON.stringify(data), /secret|https/);
});
test('distinguishes a source relation from a bounded map preview', () => {
  const data = createAnalysisDataset({layer, relation:'p', config:{sourceType:'geoparquet'}, geometry:{field:'geom',encoding:'WKB',crs:'OGC:CRS84',crsStatus:'known'}, coverage:{scope:'source',status:'source-relation'}, freshness:{kind:'source'}});
  assert.match(describeAnalysisDataset(data), /Source relation \(not the map preview\)/); assert.match(describeAnalysisDataset(data), /not version-pinned/);
});
test('removal and reset release only map-owned relations and advance reset epoch', async () => {
  const removed = []; const runtime = { duckdb: { removeRelation: async (name) => removed.push(name) }, analysisLayers: new Map([['a',{relation:'x'}],['b',{relation:'y'}]]), geoParquetLayers: new Map([['a',{relation:'x'}],['c',{relation:'z'}]]) };
  releaseLayerAnalysis(runtime, 'a'); assert.deepEqual(removed,['x']); assert.equal(runtime.analysisLayers.size,1);
  releaseLayerAnalysis(runtime); assert.deepEqual(removed,['x','z','y']); assert.equal(runtime.analysisEpoch,1);
});
