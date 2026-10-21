import test from 'node:test';
import assert from 'node:assert/strict';
import { BriefingSlides } from '../js/briefing-slides.js';
import { generateFilterSeries } from '../js/briefing-data-series.js';
import { formatSeriesTitle } from '../js/briefing-series-preview.js';
import { timelineIndices } from '../js/briefing-player.js';

const url = 'https://example.org/arcgis/rest/services/Fires/FeatureServer/0';
const fields = [{name:'when', type:'date'}, {name:'kind', type:'string'}];
const records = [
  {attributes:{when:1620168638301,kind:'a'},geometry:{type:'point',longitude:-120,latitude:40}},
  {attributes:{when:1665230185000,kind:'b'},geometry:{type:'point',longitude:-100,latitude:30}},
];
const camera = {center:[0,0],zoom:4,heading:0,tilt:0};

function harness(items=records) {
  const layer = {uid:'fires',url,fields};
  const moves=[], messages=[];
  const data = {layer,fields:{fields},records:items,visibleRecords:items,useAll:true};
  const controller = {getLayers:()=>[layer],getLayerConfig:()=>({url}),getFeatureFilter:async()=>null,setFeatureFilter:async()=>true,
    goToFeature:async feature=>moves.push({feature}), goToFeatures:async features=>moves.push({features}),
    setView:async view=>moves.push({view}),clearFeatureHighlight() {}};
  return {controller,moves,messages,data,slides:new BriefingSlides({getBriefing:()=>({}),saveBriefing(){},data:()=>data,mapController:controller,notify:message=>messages.push(message)})};
}

test('date series retain exact filters, show readable UTC dates and get timeline playback', () => {
  const generated=generateFilterSeries({briefing:{},field:'when',fields,records,layerRef:url,camera}).briefing.slides;
  assert.deepEqual(generated.map(s=>s.dataView.filter.values[0]),records.map(r=>r.attributes.when));
  assert.match(generated[0].title,/2021-05-04/);
  assert.deepEqual(timelineIndices(generated,0),[0,1]);
  assert.deepEqual(timelineIndices(generateFilterSeries({briefing:{},field:'kind',fields,records,layerRef:url,camera}).briefing.slides,0,fields),[]);
  const legacy=generated.map(s=>({...s,title:`when: ${s.dataView.filter.values[0]}`,generatedBy:{template:'filter-series',version:1}}));
  assert.deepEqual(timelineIndices(legacy,1,fields),[0,1]);
  assert.match(formatSeriesTitle(legacy[0],fields),/2021-05-04/);
  assert.equal(formatSeriesTitle({...legacy[0],title:'My title'},fields),'My title');
});

test('each data-driven slide frames its own feature; a fixed view remains available', async () => {
  const generated=generateFilterSeries({briefing:{},field:'when',fields,records,layerRef:url,camera}).briefing.slides;
  const {slides,moves}=harness();
  await slides.showSlideMap(generated[0]);
  await slides.showSlideMap(generated[1]);
  assert.equal(moves[0].feature,records[0]);
  assert.equal(moves[1].feature,records[1]);
  await slides.showSlideMap({...generated[1],generatedBy:{...generated[1].generatedBy,cameraPolicy:'fixed'}});
  assert.deepEqual(moves[2].view.center,[0,0]);
});

test('source fallback cannot move the camera after a newer slide', async () => {
  const generated=generateFilterSeries({briefing:{},field:'when',fields,records,layerRef:url,camera}).briefing.slides;
  const {slides,moves,controller}=harness([records[1]]);
  let resolve;
  controller.queryFeatures=()=>new Promise(done=>{resolve=done});
  const first=slides.showSlideMap(generated[0]);
  await Promise.resolve();
  await slides.showSlideMap(generated[1]);
  resolve({features:[records[0]]});
  await first;
  assert.equal(moves.length,1);
  assert.equal(moves[0].feature,records[1]);
});

test('an empty frame falls back to its saved view and explains why', async () => {
  const slide=generateFilterSeries({briefing:{},field:'when',fields,records,layerRef:url,camera}).briefing.slides[0];
  const {slides,moves,messages}=harness([]);
  await slides.showSlideMap(slide);
  assert.deepEqual(moves[0].view.center,[0,0]);
  assert.match(messages[0],/No matching feature geometry/);
});
