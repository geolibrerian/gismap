import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const code = await readFile(new URL('../js/dragon-results.js', import.meta.url), 'utf8');
function setup() {
  const listeners = new Map();
  const make = (id) => ({ id, value:'', textContent:'', hidden:false, href:'', focus(){}, showModal(){}, close(){}, setCustomValidity(){}, reportValidity(){}, addEventListener(type, fn){listeners.set(`${id}:${type}`,fn)} });
  const nodes = Object.fromEntries(['legendStory','legendScroll','legendScore','shareResults','shareDialog','shareForm','dragonName','shareClose','shareOutput','shareQr','shareLink','shareStatus','copyLink','challengeBanner','downloadQr'].map(id=>[id,make(id)]));
  let encoded = '';
  const draws = [];
  const ctx = new Proxy({}, { get: (_target, key) => (...args) => { if (key === 'drawImage') draws.push(args); }, set: () => true });
  nodes.shareQr.getContext = () => ctx;
  nodes.shareQr.toDataURL = () => 'data:image/png;base64,example';
  const context = { document:{querySelector: selector=>nodes[selector.slice(1)], createElement: () => ({})}, location:{origin:'https://gismap.online'}, navigator:{clipboard:{writeText:async()=>{}}}, URL, URLSearchParams, Math, Array, String, Number, QRCode:{toCanvas:async (_canvas, url)=>{encoded=url}} };
  runInNewContext(code, context);
  return { api:context.DragonResults, nodes, listeners, getEncoded:()=>encoded, draws };
}
test('share links preserve name and score and reject malformed results', () => {
  const {api} = setup();
  const href = api.linkFor('https://gismap.online', {name:'Sir Flaps & <friends>',score:6,distance:507});
  const result = api.parse(href);
  assert.equal(result.name, 'Sir Flaps & <friends>');
  assert.equal(result.score, 6);
  assert.equal(result.distance, 507);
  for (const bad of ['?legend=1&name=A&maidens=-1&distance=2','?legend=1&name=A&maidens=1&distance=9999999','?legend=1&name=&maidens=1&distance=2','?legend=1&name=A&maidens=NaN&distance=2']) assert.equal(api.parse('https://gismap.online/dragons/'+bad), null);
});
test('legend uses text, updates its name, and generates a QR of the result URL', async () => {
  const {api,nodes,listeners,getEncoded} = setup();
  api.show({name:'',score:1,distance:42});
  assert.match(nodes.legendStory.textContent,/THE NAMELESS DRAGON/);
  assert.match(nodes.legendStory.textContent,/RESCUED 1 MAIDEN FROM/);
  nodes.dragonName.value = '<dragon> & friends';
  await listeners.get('shareForm:submit')({preventDefault(){}});
  assert.match(nodes.legendStory.textContent,/<DRAGON> & FRIENDS/);
  assert.equal(nodes.shareOutput.hidden, false);
  assert.equal(getEncoded(), nodes.shareLink.href);
  assert.equal(api.parse(nodes.shareLink.href).name, '<dragon> & friends');
});


test('challenge compares maidens first and distance breaks ties', () => {
  const { api, nodes } = setup();
  const target = {name:'Old Wyrm', score:3, distance:100};
  assert.equal(api.beats({score:4,distance:0},target), true);
  assert.equal(api.beats({score:2,distance:999},target), false);
  assert.equal(api.beats({score:3,distance:101},target), true);
  assert.equal(api.beats({score:3,distance:100},target), false);
  api.setChallenge(target);
  assert.match(nodes.challengeBanner.textContent,/Can you beat Old Wyrm\?/);
  assert.match(nodes.challengeBanner.textContent,/3 maidens · 100 leagues/);
  api.setChallenge(null);
  assert.equal(nodes.challengeBanner.hidden, true);
});

test('winning challenge survives sharing and appears in the legend, but ties do not', () => {
  const { api } = setup();
  const target = {name:'Old Wyrm',score:3,distance:100};
  const winner = {name:'New Wyrm',score:3,distance:101,beaten:target};
  const restored = api.parse(api.linkFor('https://gismap.online',winner));
  assert.equal(restored.beaten.name, 'Old Wyrm');
  assert.match(api.storyFor(restored),/SURPASSED THE LEGEND OF OLD WYRM/);
  const tie = {...winner,distance:100};
  assert.equal(api.parse(api.linkFor('https://gismap.online',tie)).beaten, undefined);
  assert.doesNotMatch(api.storyFor(tie),/SURPASSED THE LEGEND/);
  assert.equal(api.parse('https://gismap.online/dragons/?legend=1&name=A&maidens=1&distance=2&beaten=B&beatenMaidens=9&beatenDistance=0').beaten, undefined);
});

test('share generates a decorated downloadable QR without drawing over its quiet zone', async () => {
  const { api,nodes,listeners,draws } = setup();
  api.show({name:'',score:5,distance:123});
  nodes.dragonName.value = 'Flap';
  await listeners.get('shareForm:submit')({preventDefault(){}});
  assert.equal(nodes.shareQr.width,600);
  assert.equal(nodes.shareQr.height,760);
  assert.equal(nodes.downloadQr.hidden,false);
  assert.match(nodes.downloadQr.href,/^data:image\/png/);
  assert.equal(draws.length,1);
  assert.deepEqual(draws[0].slice(1),[80,160,440,440]);
});
