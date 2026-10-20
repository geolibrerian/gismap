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

test('rolling and validity year windows follow distinct event and lifetime semantics', () => {
  const data = [
    {attributes:{year:2018,until:2020}}, {attributes:{year:2019,until:null}},
    {attributes:{year:2020,until:2021}},
  ];
  const extended = [...fields,{name:'until',type:'integer'}];
  const rolling=previewTimeline({...options,fields:extended,records:data,mode:'rolling',rolling:2});
  assert.deepEqual(rolling.frames.map(frame=>frame.count),[1,2,2,1]);
  const validity=previewTimeline({...options,fields:extended,records:data,mode:'validity',endField:'until'});
  assert.deepEqual(validity.frames.map(frame=>frame.count),[1,2,2,1]);
  const predicate=compileWhere(seriesWhere(validity.frames[2].filter,extended));
  assert.equal(predicate(data[0].attributes),false);
  assert.equal(predicate(data[1].attributes),true);
});

test('date windows use UTC half-open bounds, calendar anchor, and portable filters', async () => {
  const {previewDateTimeline} = await import('../js/briefing-timeline-dates.js');
  const fs=[{name:'observed',type:'date'},{name:'expires',type:'date'}];
  const rs=['2020-01-31T00:00:00Z','2020-02-29T00:00:00Z','2020-03-31T00:00:00Z'].map(value=>({attributes:{observed:value,expires:null}}));
  const opts={field:'observed',fields:fs,records:rs,start:'2020-01-31',end:'2020-04-01',unit:'month'};
  const p=previewDateTimeline(opts);
  assert.deepEqual(p.frames.map(f=>f.count),[1,1,1]);
  assert.equal(new Date(p.frames[1].intervalEnd).toISOString(),'2020-03-31T00:00:00.000Z');
  const where=seriesWhere(p.frames[1].filter,fs);
  assert.equal(compileWhere(where)(rs[1].attributes),true);
  assert.equal(compileWhere(where)(rs[2].attributes),false);
  const doc=generateTimeline({...opts,kind:'date',briefing:{},layerRef:'layer',camera:{center:[0,0],zoom:3}}).briefing;
  assert.equal(doc.slides[0].generatedBy.group,doc.slides[1].generatedBy.group);
  assert.equal(normalizeBriefing(JSON.parse(JSON.stringify(doc))).slides[0].dataView.filter.op,'date-range');
  assert.throws(()=>previewDateTimeline({...opts,start:'2020-02-30'}),/valid dates/);
});

test('playback only groups slides belonging to the same timeline', async () => {
  const {timelineIndices} = await import('../js/briefing-player.js');
  const slides=[{generatedBy:{template:'timeline',group:'a'}},{generatedBy:{template:'timeline',group:'b'}},{generatedBy:{template:'timeline',group:'a'}},{}];
  assert.deepEqual(timelineIndices(slides,0),[0,2]);
  assert.deepEqual(timelineIndices(slides,1),[1]);
  assert.deepEqual(timelineIndices(slides,3),[]);
});

test('single-slide timeline keeps frames portable without consuming a slot per frame', () => {
  const briefing={slides:Array.from({length:59},(_,i)=>({id:`s${i}`,template:'title'}))};
  const result=generateTimeline({...options,briefing,layerRef:'layer',camera:{center:[0,0],zoom:4},presentationMode:'single-slide'});
  assert.equal(result.briefing.slides.length,60);
  const slide=normalizeBriefing(JSON.parse(JSON.stringify(result.briefing))).slides.at(-1);
  assert.equal(slide.timeline.frames.length,4);
  assert.equal(slide.timeline.frames[2].filter.start,2020);
  assert.deepEqual(slide.dataView.filter,slide.timeline.frames[0].filter);
  assert.throws(()=>generateTimeline({...options,briefing,layerRef:'layer',camera:{center:[0,0],zoom:4}}),/exceed/);
});

test('calendar boundaries use the specified timezone across daylight saving', async () => {
  const {previewDateTimeline} = await import('../js/briefing-timeline-dates.js');
  const opts={field:'when',fields,records:[],start:'2024-03-09',end:'2024-03-11',unit:'day',timeZone:'America/Los_Angeles'};
  const p=previewDateTimeline(opts);
  assert.deepEqual(p.frames.map(f => new Date(f.filter.start).toISOString()),['2024-03-09T08:00:00.000Z','2024-03-10T08:00:00.000Z','2024-03-11T07:00:00.000Z']);
  assert.equal(p.frames[1].filter.end-p.frames[1].filter.start,23*3600000);
  assert.throws(()=>previewDateTimeline({...opts,timeZone:'Not/AZone'}),/timezone/);
});

test('timeline generates editable, explicitly sampled descriptions and requested numeric stats', () => {
  const extended=[...fields,{name:'cost',type:'double'}];
  const result=generateTimeline({...options, fields:extended, briefing:{}, layerRef:'layer', camera:{center:[0,0],zoom:4}, stat:'sum',statField:'cost',narration:true});
  const slide=result.briefing.slides[1];
  assert.equal(slide.blocks.find(b=>b.stat==='sum').field,'cost');
  assert.match(slide.blocks.find(b=>b.type==='text').markdown,/loaded features.*1 more feature/);
  const single=generateTimeline({...options, briefing:{}, layerRef:'layer',camera:{center:[0,0],zoom:4},presentationMode:'single-slide',narration:true}).briefing.slides[0];
  assert.match(single.timeline.frames[1].narrative,/loaded features/);
  assert.throws(()=>generateTimeline({...options,briefing:{},layerRef:'layer',camera:{center:[0,0],zoom:4},stat:'sum',statField:'when'}),/numeric field/);
});
