import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFilterSeries, seriesWhere } from '../js/briefing-data-series.js';
import { normalizeBriefing } from '../js/briefing-document.js';
import { compileWhere } from '../js/engines/maplibre/where.js';
const fields = [{name:'district'}];
const records = [{attributes:{district:"O'Brien"}},{attributes:{district:'North'}}];

test('generates editable, portable slides without changing the input', () => {
  const input = {slides: [{id:'existing', template:'title', title:'Keep me'}]};
  const before = structuredClone(input);
  const result = generateFilterSeries({briefing:input, field:'district', fields, records, layerRef:'https://example.org/FeatureServer/0', camera:{center:[0,0],zoom:5}});
  assert.deepEqual(input,before);
  assert.equal(result.briefing.slides.length,3);
  assert.equal(result.briefing.slides[0].title,'Keep me');
  const roundtrip = normalizeBriefing(JSON.parse(JSON.stringify(result.briefing)));
  const slide = roundtrip.slides.find(s => s.dataView?.filter.values[0] === "O'Brien");
  assert.ok(slide);
  const where = seriesWhere(slide.dataView.filter, fields);
  assert.equal(where,"district = 'O''Brien'");
  assert.equal(compileWhere(where)({district:"O'Brien"}),true);
  assert.equal(compileWhere(where)({district:'North'}),false);
});

test('rejects unknown fields, injection, and slide overflow atomically', () => {
  assert.throws(() => seriesWhere({op:'in',field:'x;DROP',values:['x']},[{name:'x;DROP'}]), /unsupported/);
  assert.throws(() => seriesWhere({op:'in',field:'district',values:[{}]},fields), /invalid/);
  assert.throws(() => generateFilterSeries({briefing:{slides:Array.from({length:59},(_,i)=>({id:String(i),template:'title'}))},field:'district',fields,records,layerRef:'layer'}), /slide slots/);
});

test('slide playback intersects and restores an existing feature filter', async () => {
  const { BriefingSlides } = await import('../js/briefing-slides.js');
  const layer = {uid:'u',id:'layer',queryable:true};
  let filter = {objectIds:[1,2], where:'active = 1'};
  const original = structuredClone(filter);
  const mapController = {
    getLayers: () => [layer], getLayerConfig: () => ({}),
    getFeatureFilter: async () => filter,
    setFeatureFilter: async (_uid, value) => { filter = value; return true; },
    setVisibility: () => {},
  };
  const slides = new BriefingSlides({mapController, data:()=>({layer,fields:{fields},records:[]}), getBriefing:()=>({})});
  await slides.applySlideLayers({dataView:{layer:'layer',filter:{op:'in',field:'district',values:['North']}}});
  assert.deepEqual(filter.objectIds,[1,2]);
  assert.equal(filter.where,"(active = 1) AND (district = 'North')");
  await slides.restoreLayers();
  assert.deepEqual(filter,original);
});
