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

test('eligible analysis layers exclude remote feature services but retain source GeoParquet', async () => {
  const { analysisLayerChoices } = await import('../js/duckdb-query-workspace.js');
  const layers = [{uid:'local',queryable:true}, {uid:'remote',queryable:true}, {uid:'parquet',queryable:true}];
  const map = {getLayers:() => layers, getLayerConfig:(layer) => ({local:layer.uid === 'local'})};
  assert.deepEqual(analysisLayerChoices(map,{geoParquetLayers:new Map([['parquet',{}]])}).map(l=>l.uid), ['local','parquet']);
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
