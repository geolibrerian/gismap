import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuery, boundedSql } from '../js/duckdb-query-workspace.js';
const schema = [{ column_name: 'x"name', column_type: 'VARCHAR' }, { column_name: 'value', column_type: 'INTEGER' }];
test('builder quotes discovered identifiers and binds values', () => {
  const result = buildQuery({ table: 'my_table', schema, fields: ['x"name'], filterField: 'x"name', operator: 'contains', value: "x' OR 1=1 --", orderField: 'value', descending: true, limit: 3 });
  assert.equal(result.sql, 'SELECT "x""name" FROM "my_table" WHERE contains(CAST("x""name" AS VARCHAR), ?) ORDER BY "value" DESC LIMIT 4');
  assert.deepEqual(result.params, ["x' OR 1=1 --"]);
  assert.throws(() => buildQuery({table:'a', schema, fields:['bad']}), /no longer available/);
  assert.throws(() => buildQuery({table:'a', schema, filterField:'value', operator:'; DROP'}), /Unsupported/);
});
test('builder handles null filters and caps results', () => {
  const result = buildQuery({table:'x', schema, filterField:'value', operator:'notnull', limit:999999});
  assert.match(result.sql, /IS NOT NULL LIMIT 5001$/); assert.deepEqual(result.params, []);
});
test('SQL is bounded and rejects mutations and multiple statements', () => {
  assert.match(boundedSql('SELECT * FROM foo;', 20).sql, /LIMIT 21$/);
  assert.throws(() => boundedSql('DROP TABLE foo', 20), /read-only/);
  assert.throws(() => boundedSql('SELECT 1; SELECT 2', 20), /one read-only/);
});

test('eligible analysis layers include local files, feature services and GeoParquet but not tiles', async () => {
  const { analysisLayerChoices } = await import('../js/duckdb-query-workspace.js');
  const layers = [{uid:'local',queryable:true}, {uid:'remote',queryable:true}, {uid:'tiles',queryable:false}, {uid:'parquet',queryable:false}];
  const map = {getLayers:() => layers, getLayerConfig:(layer) => ({local:layer.uid === 'local'})};
  assert.deepEqual(analysisLayerChoices(map,{geoParquetLayers:new Map([['parquet',{}]])}).map(l=>l.uid), ['local','remote','parquet']);
});
test('spatial operations compile to bounded, quoted, read-only SQL', async () => {
  const { spatialAnalysisSql, boundedSql, SPATIAL_OPERATIONS } = await import('../js/duckdb-query-workspace.js');
  const states = {relation:'states"x',geometry:{field:'__gismap_geometry',encoding:'geojson-text'}};
  const cities = {relation:'cities',geometry:{field:'geom',encoding:'duckdb-geometry'}};
  for (const operation of Object.keys(SPATIAL_OPERATIONS)) {
    const sql = spatialAnalysisSql({ operation, source: states, comparison: cities, distance: 5, unit: 'km' });
    assert.match(sql, /FROM "states""x" AS a/);
    assert.match(sql, /AS "__gismap_geometry"/);
    assert.match(boundedSql(sql, 10).sql, /LIMIT 11$/);
  }
  assert.match(spatialAnalysisSql({ operation: 'buffer', source: states, distance: 2, unit: 'mi' }), /ST_Buffer\(ST_Transform\(ST_GeomFromGeoJSON\(a\."__gismap_geometry"\), 'EPSG:4326', 'EPSG:3857', true\), 3218\.688 \/ cos/);
  assert.match(spatialAnalysisSql({ operation: 'within', source: states, comparison: cities, distance: 500, unit: 'm' }), /ST_DWithin\([^]*b\."geom"[^]*500 \/ cos/);
  assert.match(spatialAnalysisSql({ operation: 'measure', source: states }), /ST_Area_Spheroid\(ST_FlipCoordinates/);
  assert.match(spatialAnalysisSql({ operation: 'dissolve', source: states, groupField: 'state"name' }), /GROUP BY a\."state""name"/);
  assert.throws(() => spatialAnalysisSql({ operation: 'count', source: states }), /second, different dataset/);
  assert.throws(() => spatialAnalysisSql({ operation: 'buffer', source: states, distance: -1 }), /greater than 0/);
  assert.throws(() => spatialAnalysisSql({ operation: 'buffer', source: states, distance: 2000, unit: 'km' }), /1,000 km/);
  assert.throws(() => spatialAnalysisSql({ operation: 'nope', source: states }), /Choose a spatial operation/);
});
test('spatial intersection template quotes names and converts mixed geometry formats', async () => {
  const { spatialJoinExample } = await import('../js/duckdb-query-workspace.js');
  const local = {relation:'places"one',geometry:{field:'__gismap_geometry',encoding:'geojson-text'}};
  const parquet = {relation:'zones',geometry:{field:'geom',encoding:'duckdb-geometry'}};
  const sql = spatialJoinExample(local,parquet);
  assert.match(sql,/FROM "places""one" AS a/);
  assert.match(sql,/ST_Intersects\(ST_GeomFromGeoJSON\(a\."__gismap_geometry"\), b\."geom"\)/);
  assert.match(spatialJoinExample(parquet,local),/ST_AsGeoJSON\(a\."geom"\) AS "__gismap_geometry"/);
  assert.match(spatialJoinExample({...parquet,geometry:{field:'g',encoding:'WKB'}},local),/ST_GeomFromWKB\(a\."g"\)/);
  assert.throws(() => spatialJoinExample(local,local),/different/);
  assert.throws(() => spatialJoinExample(local,{...parquet,geometry:{field:'g',encoding:'unknown'}}),/recognized/);
});
