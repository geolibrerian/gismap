import test from 'node:test';
import assert from 'node:assert/strict';
import { initializeStudioTabs } from '../js/studio-tabs.js';

function fixture() {
  const node = (key, name) => ({ dataset: { [key]: name }, attrs: {}, listeners: {}, hidden: false, disabled: false,
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(event, fn) { this.listeners[event] = fn; },
    focus() { this.focused = true; },
  });
  const tabs = ['color', 'height', 'effects'].map(name => node('studioTab', name));
  const panes = ['color', 'height', 'effects'].map(name => node('studioPane', name));
  const root = { querySelectorAll: selector => selector === '[data-studio-tab]' ? tabs : panes };
  return { tabs, panes, root };
}

test('tabs preserve draft controls while exposing a single accessible panel', () => {
  const { tabs, panes, root } = fixture();
  panes[0].draft = { value: 'unsaved color' };
  const draft = panes[0].draft;
  const controller = initializeStudioTabs(root, { id: 'test' });
  assert.equal(tabs[0].attrs['aria-selected'], 'true');
  assert.equal(tabs[0].attrs['aria-controls'], panes[0].id);
  assert.equal(panes[0].attrs['aria-labelledby'], tabs[0].id);
  tabs[2].listeners.click();
  assert.deepEqual(panes.map(pane => pane.hidden), [true, true, false]);
  controller.select('color');
  assert.equal(panes[0].draft, draft);
  assert.equal(draft.value, 'unsaved color');
  assert.deepEqual(tabs.map(tab => tab.tabIndex), [0, -1, -1]);
});

test('keyboard navigation skips disabled tabs, wraps, and supports Home/End', () => {
  const { tabs, panes, root } = fixture();
  tabs[1].disabled = true;
  initializeStudioTabs(root);
  const key = (index, value) => tabs[index].listeners.keydown({ key: value, preventDefault() {} });
  key(0, 'ArrowRight');
  assert.equal(tabs[2].attrs['aria-selected'], 'true');
  assert.equal(tabs[2].focused, true);
  key(2, 'ArrowRight');
  assert.equal(tabs[0].attrs['aria-selected'], 'true');
  key(0, 'End');
  assert.equal(panes[2].hidden, false);
  key(2, 'Home');
  assert.equal(panes[0].hidden, false);
});

test('returning to 2D safely leaves the disabled height panel', () => {
  const { tabs, panes, root } = fixture();
  const controller = initializeStudioTabs(root, { initial: 'height' });
  assert.equal(panes[1].hidden, false);
  tabs[1].disabled = true;
  controller.refresh();
  assert.equal(panes[1].hidden, true);
  assert.equal(panes[0].hidden, false);
  assert.equal(tabs[0].tabIndex, 0);
});
