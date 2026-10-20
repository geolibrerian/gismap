import test from 'node:test';
import assert from 'node:assert/strict';
import {timelinePdfFrames, parseTimelineFrameSelection, expandTimelinePdfSlides} from '../js/briefing-timeline-pdf.js';
const slides=[{id:'cover',title:'Intro'},{id:'one',title:'History',dataView:{layer:'x',filter:{op:'first'}},timeline:{frames:[{title:'2000',filter:{op:'one'},narrative:'First'},{title:'2001',filter:{op:'two'},narrative:'Second'}]},generatedBy:{template:'timeline'}},{id:'two',title:'2002',generatedBy:{template:'timeline'}},{id:'hidden',hidden:true,generatedBy:{template:'timeline'}}];
test('PDF expands all or selected frames with the correct map filter and narrative',()=>{
  assert.equal(timelinePdfFrames(slides).length,3);
  assert.deepEqual(expandTimelinePdfSlides(slides).map(s=>s.id),['cover','one','two']);
  const all=expandTimelinePdfSlides(slides,{mode:'all'});
  assert.equal(all.length,4); assert.equal(all[2].dataView.filter.op,'two'); assert.equal(all[2].frameNarrative,'Second');
  const selected=expandTimelinePdfSlides(slides,{mode:'selected',selected:[1,2]});
  assert.deepEqual(selected.map(s=>s.id),['cover','one','two']); assert.equal(selected[1].dataView.filter.op,'two');
  assert.equal(slides[1].dataView.filter.op,'first');
});
test('selection parses bounded inclusive ranges and rejects invalid requests',()=>{
  assert.deepEqual(parseTimelineFrameSelection('3, 1-2,2',3),[0,1,2]);
  assert.throws(()=>parseTimelineFrameSelection('0,2',3),/between/);
  assert.throws(()=>parseTimelineFrameSelection('1-99999999',3),/between/);
  assert.throws(()=>parseTimelineFrameSelection('',3),/at least/);
});
