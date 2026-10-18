import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const code = await readFile(new URL('../js/dragon-game.js', import.meta.url), 'utf8');
function setup(shared = null) {
  const listeners = new Map();
  const make = (id) => ({ id, clientWidth: 960, style: {}, disabled: id === 'pauseButton', textContent: '', focus() {}, classList: { add() {}, remove() {} }, addEventListener(type, fn) { listeners.set(`${id}:${type}`, fn); } });
  const nodes = Object.fromEntries(['canvas','game','overlay','overlayTitle','overlayText','start','flapButton','pauseButton','score','distance','lives','sharedChallenge'].map((id) => [id,make(id)]));
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get(target, key) { if (key === 'createLinearGradient') return () => gradient; return target[key] || (() => {}); }, set(target, key, value) { target[key] = value; return true; } });
  nodes.canvas.getContext = () => context;
  let next = 0; const frames = new Map();
  const document = { hidden: false, querySelector: (selector) => nodes[selector.slice(1)], addEventListener: (type, fn) => listeners.set(`document:${type}`, fn) };
  const window = { PointerEvent: true, addEventListener: (type, fn) => listeners.set(`window:${type}`, fn) };
  let shown = null, target = null;
  const DragonResults = { hide() {}, show(value) { shown = value; }, beats: () => false, setChallenge(value) { target = value; }, challengeMessage: value => `The famous dragon ${value.name} has taken ${value.score} maidens and flown ${value.distance} leagues — can you beat ${value.name}?`, parse: () => shared };
  runInNewContext(code, { document, window, DragonResults, location: {href:'https://gismap.online/dragons/'}, Math, Array, performance: { now: () => 0 }, requestAnimationFrame: (fn) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id) => frames.delete(id) });
  return { nodes, frames, listeners, getShown: () => shown, getTarget: () => target };
}
test('game stays still until started, then pauses and resumes without duplicate frames', () => {
  const { nodes, frames, listeners } = setup();
  assert.equal(frames.size, 0);
  listeners.get('start:click')();
  assert.equal(frames.size, 1);
  assert.equal(nodes.pauseButton.disabled, false);
  listeners.get('pauseButton:click')();
  assert.equal(frames.size, 0);
  assert.equal(nodes.overlayTitle.textContent, 'Paused in the clouds');
  listeners.get('pauseButton:click')();
  assert.equal(frames.size, 1);
  listeners.get('pauseButton:click')();
  assert.equal(frames.size, 0);
});

test('keyboard shortcuts do not steal space from links or buttons', () => {
  const { frames, listeners } = setup();
  let prevented = false;
  const key = (interactive) => ({ code:'Space', target:{ closest: () => interactive }, preventDefault() { prevented=true; } });
  listeners.get('document:keydown')(key(true));
  assert.equal(prevented, false);
  assert.equal(frames.size, 0);
  listeners.get('document:keydown')(key(false));
  assert.equal(prevented, true);
  assert.equal(frames.size, 1);
});

test('the direct dragon page is up to date and uses the same game without a 404 message', async () => {
  const { renderDragonPage } = await import('../scripts/build-dragon-page.mjs');
  const source = await readFile(new URL('../404.html', import.meta.url), 'utf8');
  const direct = await readFile(new URL('../dragons/index.html', import.meta.url), 'utf8');
  assert.equal(direct, renderDragonPage(source));
  assert.match(direct, /<title>Here be dragons \| GISMap Online<\/title>/);
  assert.match(direct, /rel="icon" href="\/assets\/gis-map-online-mark-v2\.png" type="image\/png"/);
  assert.doesNotMatch(direct, /404 ·|couldn’t find that page|content="noindex"/);
  for (const id of ['game', 'canvas', 'start', 'flapButton', 'pauseButton']) assert.match(direct, new RegExp(`id="${id}"`));
  assert.match(direct, /\/js\/dragon-game\.js\?v=6/);
  const redirects = await readFile(new URL('../_redirects', import.meta.url), 'utf8');
  assert.match(redirects, /^\/dragons \/dragons\/ 301$/m);
});


test('shared links show the previous legend followed by a playable challenge', () => {
  const shared = {name:'Flap',score:3,distance:100,beaten:{name:'Old',score:1,distance:12}};
  const {nodes,frames,listeners,getShown,getTarget} = setup(shared);
  assert.equal(nodes.overlayTitle.textContent, 'The legend of the dragon');
  assert.equal(getShown(), shared);
  assert.match(nodes.sharedChallenge.textContent, /The famous dragon Flap has taken 3 maidens and flown 100 leagues — can you beat Flap\?/);
  assert.equal(nodes.sharedChallenge.hidden, false);
  assert.equal(nodes.start.textContent, 'Take the challenge ↗');
  assert.equal(getTarget().name, 'Flap');
  listeners.get('start:click')();
  assert.equal(nodes.sharedChallenge.hidden, true);
  assert.equal(frames.size, 1);
  assert.equal(getTarget().score, 3);
});
