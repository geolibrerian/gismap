import test from 'node:test';
import assert from 'node:assert/strict';
import { previewGridAtlas, generateGridAtlas } from '../js/briefing-grid-atlas.js';
import { normalizeBriefing } from '../js/briefing-document.js';
import { BriefingSlides } from '../js/briefing-slides.js';
const records = [[0,0],[1,1],[2,2]].map(([x,y])=>({geometry:{type:'Point',coordinates:[x,y]},attributes:{}}));
const camera={center:[1,1],zoom:5};

test('point grids assign boundaries once and support traversal and empty cells',()=>{
  const p=previewGridAtlas({records,rows:2,columns:2});
  assert.deepEqual(p.cells.map(x=>x.count),[0,1,1,1]);
  assert.deepEqual(p.cells.map(x=>x.id),['r1-c1','r1-c2','r2-c1','r2-c2']);
  assert.deepEqual(previewGridAtlas({records,rows:2,columns:2,order:'snake'}).cells.map(x=>x.id),['r1-c1','r1-c2','r2-c2','r2-c1']);
  assert.deepEqual(previewGridAtlas({records,rows:2,columns:2,order:'column-major',skipEmpty:true}).cells.map(x=>x.id),['r2-c1','r1-c2','r2-c2']);
});

test('atlas generation is atomic and preserves locator and fitted bounds through serialization',()=>{
  const input={slides:[{id:'existing',template:'title',title:'Keep'}]};
  const before=structuredClone(input);
  const {briefing}=generateGridAtlas({briefing:input,records,rows:2,columns:2,camera,layerRef:'layer'});
  assert.deepEqual(input,before);
  const restored=normalizeBriefing(JSON.parse(JSON.stringify(briefing)));
  assert.equal(restored.slides.length,5);
  assert.deepEqual(restored.slides[1].generatedBy.bounds,[0,1,1,2]);
  assert.throws(()=>previewGridAtlas({records,rows:2,columns:2,availableSlides:3}),/slide slots/);
  assert.throws(()=>previewGridAtlas({records:[{geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}]}),/point geometries/);
  assert.throws(()=>previewGridAtlas({records:[{geometry:{x:1,y:1,spatialReference:{wkid:3857}}}]}),/WGS84/);
});

test('slide playback fits the selected cell and displays a locator',async()=>{
  const {briefing}=generateGridAtlas({briefing:{},records,rows:2,columns:2,camera,layerRef:'layer'});
  const calls=[]; const layer={uid:'u',id:'layer',queryable:true};
  const api={getBriefing:()=>briefing, data:()=>({layer,records:[],fields:{fields:[]},title:'Test'}),mapController:{getLayers:()=>[layer],getLayerConfig:()=>({}),setView:async target=>calls.push(target),clearFeatureHighlight(){}}};
  const slides=new BriefingSlides(api); const slide=briefing.slides[1];
  await slides.showSlideMap(slide);
  assert.deepEqual(calls[0].bounds,[1,1,2,2]);
  assert.match(slides.slideHtml(slide),/Locator: row 1 of 2, column 2 of 2/);
});
