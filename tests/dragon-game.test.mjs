import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const code = await readFile(new URL('../js/dragon-game.js', import.meta.url), 'utf8');
function setup() {
  const listeners = new Map();
  const make = (id) => ({ id, clientWidth: 960, style: {}, disabled: id === 'pauseButton', textContent: '', focus() {}, classList: { add() {}, remove() {} }, addEventListener(type, fn) { listeners.set(`${id}:${type}`, fn); } });
  const nodes = Object.fromEntries(['canvas','game','overlay','overlayTitle','overlayText','start','flapButton','pauseButton','score','distance','lives'].map((id) => [id,make(id)]));
  const gradient = { addColorStop() {} };
  const context = new Proxy({}, { get(target, key) { if (key === 'createLinearGradient') return () => gradient; return target[key] || (() => {}); }, set(target, key, value) { target[key] = value; return true; } });
  nodes.canvas.getContext = () => context;
  let next = 0; const frames = new Map();
  const document = { hidden: false, querySelector: (selector) => nodes[selector.slice(1)], addEventListener: (type, fn) => listeners.set(`document:${type}`, fn) };
  const window = { PointerEvent: true, addEventListener: (type, fn) => listeners.set(`window:${type}`, fn) };
  runInNewContext(code, { document, window, Math, Array, performance: { now: () => 0 }, requestAnimationFrame: (fn) => { frames.set(++next, fn); return next; }, cancelAnimationFrame: (id) => frames.delete(id) });
  return { nodes, frames, listeners };
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
