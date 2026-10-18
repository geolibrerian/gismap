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
  runInNewContext(code, { document, window, DragonResults, DragonArt: { drawDragon() {} }, location: {href:'https://gismap.online/dragons/'}, Math, Array, performance: { now: () => 0 }, requestAnimationFrame: (fn) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id) => frames.delete(id) });
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
  assert.match(direct, /\/js\/dragon-game\.js\?v=10/);
  assert.match(direct, /download="here-be-dragons\.png"/);
  assert.doesNotMatch(direct, /id="shareQrBrand"/);
  assert.match(direct, /href="\/examples\/">See examples<\/a>/);
  assert.match(direct, />Download QR Card<\/a>/);
  assert.match(direct, /type="submit">Share your legend<\/button>/);
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

test('shared dragon artwork draws the in-game dragon in both flight and card poses', async () => {
  const source = await readFile(new URL('../js/dragon-art.js', import.meta.url), 'utf8');
  const calls = [];
  const ctx = new Proxy({}, { get: (_target, name) => (...args) => calls.push([name, ...args]), set: () => true });
  const scope = { Math };
  runInNewContext(source, scope);
  scope.DragonArt.drawDragon(ctx, {x:225,y:205,vy:-200,flap:0.26,invuln:0}, 1);
  scope.DragonArt.drawDragon(ctx, {x:0,y:0,vy:0,flap:1,invuln:0}, 0);
  assert.ok(calls.filter(([name]) => name === 'bezierCurveTo').length > 10);
  assert.ok(calls.some(([name, x, y]) => name === 'translate' && x === 225 && y === 205));
  assert.ok(calls.some(([name, x, y]) => name === 'translate' && x === 0 && y === 0));
});


test('serpents leap near the top, drift down, and their collision box follows', () => {
  const start = code.indexOf('function serpentRise(h)');
  const end = code.indexOf('function knightThrust(h)', start);
  const helpers = code.slice(start, end);
  const scope = { Math, clamp:(v,a,b)=>Math.max(a,Math.min(b,v)) };
  runInNewContext(`${helpers}; globalThis.rise=serpentRise; globalThis.box=serpentCollisionBox;`, scope);
  const h = {x:300,y:385};
  assert.equal(scope.rise(h), 0);
  h.jumpElapsed = .65;
  const top = scope.rise(h);
  assert.equal(top, 327);
  assert.equal(h.y-top-54, 4); // The serpent's head reaches the top edge.
  assert.equal(scope.box(h).y, h.y-top-50);
  h.jumpElapsed = 1.5;
  const mid = scope.rise(h);
  assert.ok(mid > 0 && mid < top);
  assert.equal(scope.box(h).y, h.y-mid-50);
  h.jumpElapsed = 4;
  assert.equal(scope.rise(h), 0);
});

test('serpents begin their leap on approach in desktop and mobile worlds', () => {
  const start = code.indexOf('function updateSerpentJump(h,dt)');
  const end = code.indexOf('function serpentRise(h)', start);
  const helper = code.slice(start, end);
  for (const [width, dragonX] of [[960,225],[440,128]]) {
    const scope = {W:width,dragon:{x:dragonX},clamp:(v,a,b)=>Math.max(a,Math.min(b,v))};
    runInNewContext(`${helper}; globalThis.advance=updateSerpentJump;`, scope);
    const serpent = {x:width+90};
    scope.advance(serpent,.02);
    assert.equal(serpent.jumpElapsed, undefined);
    serpent.x = dragonX + Math.max(230,Math.min(440,width*.46));
    scope.advance(serpent,.02);
    assert.equal(serpent.jumpElapsed,.02);
  }
});
