import test from 'node:test';
import assert from 'node:assert/strict';
import { isSharedLaunch, createSharedLoading } from '../js/shared-loading.js';

test('detects supported shared experiences without showing on ordinary maps', () => {
  for (const address of ['#briefing=b1.x', '#map=json:x', '#tour=x', '#fieldTask=x', '?spec=https://example.org/a', '?layer=https://example.org/a', '?example=air', '?briefing=https://example.org/a']) {
    const u = new URL(address, 'https://gismap.online/');
    assert.equal(isSharedLaunch(u), true, address);
  }
  assert.equal(isSharedLaunch(new URL('https://gismap.online/?engine=maplibre')), false);
});

test('reports progress, handles a slow load, and always hides on finish', () => {
  const message = { textContent: '' };
  const element = { hidden: true, querySelector: () => message };
  let timer, cleared;
  const loading = createSharedLoading({ element, location: { hash: '#briefing=x' }, setTimer: (fn) => { timer = fn; return 42; }, clearTimer: (id) => { cleared = id; } });
  assert.equal(element.hidden, false);
  loading.update('Preparing');
  assert.equal(message.textContent, 'Preparing');
  timer();
  assert.match(message.textContent, /longer/);
  loading.finish();
  assert.equal(element.hidden, true);
  assert.equal(cleared, 42);
  loading.update('late'); timer();
  assert.match(message.textContent, /longer/);
});
