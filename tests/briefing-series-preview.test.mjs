import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { previewFilterSeries } from '../js/briefing-series-preview.js';
import { matchesFilter } from '../js/briefing-document.js';
const fields = [{name:'YEAR_',type:'integer'}];
const records = [2020, 2018, 2020, null, 2019].map(year => ({attributes:{YEAR_:year}}));

test('unique-value preview builds ordered typed subsets without modifying the source', () => {
  const before = structuredClone(records);
  const preview = previewFilterSeries({field:'YEAR_', fields, records, availableSlides:2});
  assert.deepEqual(preview.subsets.map(item => [item.filter.values[0],item.count]), [[2018,1],[2019,1],[2020,2]]);
  assert.equal(preview.missing,1);
  assert.equal(preview.canGenerate,false);
  assert.match(preview.warnings.join(' '), /loaded, included/);
  assert.match(preview.warnings.join(' '), /exceed/);
  for (const subset of preview.subsets) assert.equal(records.filter(record => matchesFilter(subset.filter, record.attributes)).length, subset.count);
  assert.deepEqual(records,before);
});

test('preview rejects missing fields, reports missing values, and never truncates subsets', () => {
  assert.throws(() => previewFilterSeries({ field:'bad',fields,records }), /current layer/);
  const empty = previewFilterSeries({field:'YEAR_', fields, records: [{attributes:{YEAR_:null}}]});
  assert.equal(empty.subsets.length,0);
  assert.match(empty.warnings.join(' '),/No nonempty/);
  const many = previewFilterSeries({field:'YEAR_',fields,records:Array.from({length:65},(_,i) => ({attributes:{YEAR_:i}}))});
  assert.equal(many.subsets.length,65);
  assert.match(many.warnings.join(' '), /exceed/);
});

test('Briefing authoring exposes a preview and explicitly does not promise slide creation', async () => {
  const code = await readFile(new URL('../js/briefing-slides.js',import.meta.url),'utf8');
  assert.match(code, /data-series-preview/);
  assert.match(code, /data\.fields\?\.fields/);
  assert.match(code, /does not create slides/);
});
