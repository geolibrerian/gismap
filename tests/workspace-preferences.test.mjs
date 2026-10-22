import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkspacePreferences } from '../js/workspace-preferences.js';

test('pins and workspace history survive reload and reset is reversible', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  const state = createWorkspacePreferences(storage);
  state.pin('layers-panel', true);
  state.select('notes');
  const reloaded = createWorkspacePreferences(storage);
  assert.deepEqual(reloaded.snapshot(), { selected: 'notes', previous: 'layers', pinned: ['layers-panel'] });
  reloaded.reset();
  assert.deepEqual(reloaded.snapshot(), { selected: 'layers', previous: 'notes', pinned: [] });
  assert.equal(reloaded.restore(), true);
  assert.equal(reloaded.snapshot().selected, 'notes');
  assert.deepEqual(reloaded.snapshot().pinned, ['layers-panel']);
});

test('invalid stored panel ids and unavailable storage are handled safely', () => {
  const state = createWorkspacePreferences({ getItem: () => '{"selected":"invalid","pinned":["unknown","draw-panel"]}', setItem() { throw new Error('blocked'); } });
  assert.deepEqual(state.snapshot(), { selected: 'layers', previous: null, pinned: ['draw-panel'] });
  assert.equal(state.pin('unknown', true), false);
  assert.equal(state.select('explore'), true);
});
