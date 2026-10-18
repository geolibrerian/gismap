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
