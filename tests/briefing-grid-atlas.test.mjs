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
  assert.throws(()=>previewGridAtlas({records:[{geometry:{type:'LineString',coordinates:[[0,0]]}}]}),/malformed/);
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


test('lines and polygons report intersections separately from single assignment',()=>{
  const data=[
    {geometry:{type:'LineString',coordinates:[[0,1],[2,1]]}},
    {geometry:{type:'Polygon',coordinates:[[[0,0],[2,0],[2,2],[0,2],[0,0]]]}},
  ];
  const a=previewGridAtlas({records:data,rows:2,columns:2,countMode:'intersecting'});
  assert.deepEqual(a.cells.map(c=>c.intersecting),[2,2,2,2]);
  assert.deepEqual(a.cells.map(c=>c.assigned),[2,0,0,0]);
  const b=previewGridAtlas({records:data,rows:2,columns:2,skipEmpty:true,countMode:'assigned'});
  assert.deepEqual(b.cells.map(c=>c.id),['r1-c1']);
});

test('intersection respects polygon holes and does not use feature bounding boxes as exact geometry',async()=>{
  const {atlasGeometry,atlasIntersects}=await import('../js/briefing-grid-geometry.js');
  const donut=atlasGeometry({type:'Polygon',coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[8,2],[8,8],[2,8],[2,2]]]});
  assert.equal(atlasIntersects(donut,[3,3,4,4]),false);
  assert.equal(atlasIntersects(donut,[1,3,3,4]),true);
  const line=atlasGeometry({type:'LineString',coordinates:[[0,0],[10,10]]});
  assert.equal(atlasIntersects(line,[0,8,1,9]),false);
  assert.equal(atlasIntersects(line,[4,4,5,5]),true);
  const poly=atlasGeometry({rings:[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[2,2],[8,2],[8,8],[2,8],[2,2]]],spatialReference:{wkid:4326}});
  assert.equal(atlasIntersects(poly,[3,3,4,4]),false);
});

test('target slide count chooses a deterministic bounded grid and validates limits',()=>{
  const p=previewGridAtlas({records,targetCells:10});
  assert.ok(p.rows * p.columns <= 10 && p.rows*p.columns >= 6);
  assert.deepEqual(previewGridAtlas({records,targetCells:10}).cells.map(c=>c.bounds),p.cells.map(c=>c.bounds));
  assert.throws(()=>previewGridAtlas({records,targetCells:61}),/target/);
});

test('point boundary intersection count is distinct from unique assignment',()=>{
  const p=previewGridAtlas({records,rows:2,columns:2,countMode:'intersecting'});
  assert.equal(p.cells.reduce((n,c)=>n+c.assigned,0),3);
  assert.equal(p.cells.reduce((n,c)=>n+c.intersecting,0),6);
});

test('a fixed area (e.g. the map view) sets the grid and ignores features outside it', async () => {
  const { extentToBounds } = await import('../js/briefing-grid-atlas.js');
  const p = previewGridAtlas({ records, bounds: [0.5, 0.5, 4.5, 4.5], rows: 2, columns: 2 });
  assert.deepEqual(p.bounds, [0.5, 0.5, 4.5, 4.5]);
  assert.equal(p.area, 'bounds');
  assert.equal(p.recordCount, 2, 'the point at 0,0 lies outside the area');
  assert.equal(p.cells.reduce((n, c) => n + c.assigned, 0), 2);
  // An empty area still makes a grid; skipping empty cells can leave none.
  assert.equal(previewGridAtlas({ records, bounds: [50, 50, 60, 60], rows: 2, columns: 2 }).cells.length, 4);
  assert.equal(previewGridAtlas({ records: [], bounds: [50, 50, 60, 60], rows: 1, columns: 1 }).recordCount, 0);
  // A zoomed-out view may span more than 180 degrees.
  assert.equal(previewGridAtlas({ records, bounds: [-180, -60, 180, 80], rows: 2, columns: 2 }).cells.length, 4);
  assert.throws(() => previewGridAtlas({ records, bounds: [10, 0, 5, 5] }), /map area/);
  assert.throws(() => previewGridAtlas({ records: [] }), /at least one/);
  // Web Mercator extents (ArcGIS) convert to degrees.
  const [w, s, e, n] = extentToBounds({ xmin: -20037508.34, ymin: 0, xmax: 0, ymax: 20037508.34 / 2, spatialReference: { wkid: 102100 } });
  assert.ok(Math.abs(w + 180) < 1e-6 && Math.abs(s) < 1e-9 && e === 0 && n > 66 && n < 67);
  assert.deepEqual(extentToBounds({ xmin: 1, ymin: 2, xmax: 3, ymax: 4, spatialReference: { wkid: 4326 } }), [1, 2, 3, 4]);
  assert.equal(extentToBounds(null), null);
});
