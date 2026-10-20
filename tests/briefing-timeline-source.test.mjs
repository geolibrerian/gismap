import test from 'node:test';
import assert from 'node:assert/strict';
import { createTimelineSourceCache } from '../js/briefing-timeline-source.js';

const fields = [{name:'YEAR_',type:'integer'}, {name:'ACRES',type:'double'}];
const request = {url:'https://example.org/arcgis/rest/services/fires/FeatureServer/0', fields, filter:{op:'year-range',field:'YEAR_',start:2020,end:2021}};

test('source timeline requests use validated interval and layer filters, deduplicate and expire', async () => {
  let clock = 0; const calls = [];
  const cache = createTimelineSourceCache({now:()=>clock, ttl:100, fetchImpl:async (url, init) => {
    calls.push({url, params:new URLSearchParams(init.body)});
    return {ok:true, json:async()=>({count:12})};
  }});
  const first = {...request, baseWhere:"STATE = 'CA'"};
  assert.deepEqual(await Promise.all([cache.query(first),cache.query(first)]), [{count:12,value:null},{count:12,value:null}]);
  assert.equal(calls.length,1);
  assert.match(calls[0].params.get('where'), /STATE = 'CA'.*YEAR_/);
  assert.equal(calls[0].params.get('returnCountOnly'),'true');
  clock=101; await cache.query(first); assert.equal(calls.length,2);
  await assert.rejects(cache.query({...request,url:'https://example.org/a?token=secret'}), /direct ArcGIS/);
});

test('source statistic queries run in bounded batches and failures are not cached', async () => {
  let active=0, peak=0, calls=0, fail=true;
  const cache = createTimelineSourceCache({fetchImpl:async (_url,init) => {
    calls++; active++; peak=Math.max(peak,active);
    await new Promise(resolve=>setTimeout(resolve,5)); active--;
    const p=new URLSearchParams(init.body);
    assert.match(p.get('outStatistics'), /timeline_value/);
    return {ok:true,json:async()=>fail ? {error:{message:'No statistics'}} : {features:[{attributes:{timeline_count:4,timeline_value:8}}]}};
  }});
  const requests=Array.from({length:4},(_,i)=>({...request,filter:{...request.filter,start:2020+i,end:2021+i},stat:'sum',statField:'ACRES'}));
  await assert.rejects(cache.query(requests[0]),/No statistics/); fail=false;
  const values=await cache.prefetch(requests,{concurrency:2});
  assert.deepEqual(values,Array(4).fill({count:4,value:8}));
  assert.ok(peak<=2); assert.equal(calls,5);
});
