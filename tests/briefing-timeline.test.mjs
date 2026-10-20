import test from 'node:test';
import assert from 'node:assert/strict';
import { previewTimeline, generateTimeline, isYearField } from '../js/briefing-timeline.js';
import { seriesWhere } from '../js/briefing-data-series.js';
import { compileWhere } from '../js/engines/maplibre/where.js';
import { normalizeBriefing } from '../js/briefing-document.js';
const fields = [{name:'year',type:'integer'}, {name:'when',type:'date'}];
const records = [2018,2019,2019,2021,null,'2020'].map(year=>({attributes:{year}}));
const options = {fields, records, field:'year', start:2018,end:2021,step:1};
test('intervals are half-open, retain gaps and exclude missing or invalid years',()=>{
  const preview = previewTimeline(options);
  assert.deepEqual(preview.frames.map(x=>x.count),[1,2,0,1]);
  assert.equal(preview.missing,1); assert.equal(preview.invalid,1);
  assert.equal(isYearField(fields[1]),false);
  assert.equal(isYearField({name:'year',type:'double'}),false);
  assert.equal(isYearField({name:'year;DROP',type:'integer'}),false);
  const where = seriesWhere(preview.frames[1].filter, fields);
  assert.equal(where,'(year >= 2019 AND year < 2020)');
  assert.equal(compileWhere(where)({year:2019}),true);
  assert.equal(compileWhere(where)({year:2020}),false);
});
test('cumulative frames and uneven intervals use the requested start and inclusive end',()=>{
  const p=previewTimeline({...options,step:2,mode:'cumulative'});
  assert.deepEqual(p.frames.map(x=>x.count),[3,4]);
  assert.deepEqual(p.frames.map(x=>[x.filter.start,x.filter.end]),[[2018,2020],[2018,2022]]);
});
test('generation preserves existing slides and round-trips structured filters',()=>{
  const input={slides:[{id:'existing',template:'title',title:'Keep'}]};
  const result=generateTimeline({...options,briefing:input,layerRef:'layer',camera:{center:[0,0],zoom:4}});
  assert.equal(input.slides.length,1); assert.equal(result.briefing.slides.length,5);
  const restored=normalizeBriefing(JSON.parse(JSON.stringify(result.briefing)));
  assert.equal(restored.slides[0].title,'Keep');
  assert.deepEqual(restored.slides[2].dataView.filter,{op:'year-range',field:'year',start:2019,end:2020});
});
test('invalid options, unsafe fields, and excess frames fail without generating',()=>{
  assert.throws(()=>previewTimeline({...options,field:'when'}),/integer year/);
  assert.throws(()=>previewTimeline({...options,start:''}),/whole-number/);
  assert.throws(()=>previewTimeline({...options,end:2100}),/exceed/);
  assert.throws(()=>seriesWhere({op:'year-range',field:'year',start:0,end:'1 OR 1=1'},fields),/invalid/);
  assert.throws(()=>generateTimeline({...options,briefing:{},layerRef:'layer'}),/map view/);
});
