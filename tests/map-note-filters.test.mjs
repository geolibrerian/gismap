import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesMapNoteFilters, refreshMapNoteFilters } from '../js/map-note-filters.js';

const note = { id: 'mn1', title: 'Bridge', body: 'Inspect pavement', category: 'data-quality', status: 'open', tags: ['Priority'], target: { type: 'feature', datasetId: 'streets', featureId: '42' } };
const summary = { taskCount: 2, completed: 1, returned: 0, outstanding: 1, missing: 0, unknown: 0 };

test('filters combine search, scope, category, review and reported task status', () => {
  for (const search of ['STREETS', '42', 'priority', 'pavement']) assert.equal(matchesMapNoteFilters(note, summary, { search }), true);
  assert.equal(matchesMapNoteFilters(note, summary, { search: '42', scope: 'feature', category: 'data-quality', review: 'open', task: 'outstanding' }), true);
  for (const filters of [{ search: 'missing' }, { scope: 'project' }, { category: 'other' }, { review: 'resolved' }, { task: 'completed' }, { task: 'none' }]) assert.equal(matchesMapNoteFilters(note, summary, filters), false);
  assert.equal(matchesMapNoteFilters(note, summary, { task: 'awaiting-return' }), true);
  assert.equal(matchesMapNoteFilters(note, { ...summary, taskCount: 2, completed: 2, returned: 1, outstanding: 0 }, { task: 'completed' }), true);
  assert.equal(matchesMapNoteFilters(note, { ...summary, missing: 1 }, { task: 'unavailable' }), true);
  assert.equal(matchesMapNoteFilters(note, { ...summary, taskCount: 0, completed: 0 }, { task: 'none' }), true);
});

test('refresh updates visibility and counts without changing selections or editor state', () => {
  let current = { ...summary }; const count = { textContent: '' };
  const card = { dataset: { mapNoteId: 'mn1' }, hidden: false, selected: true };
  const controls = { search: { value: '' }, task: { value: 'outstanding' } };
  const panel = { querySelector: selector => selector === '[data-map-note-visible-count]' ? count : controls[selector.match(/"(.*?)"/)?.[1]], querySelectorAll: () => [card] };
  const root = { querySelectorAll: () => [panel] };
  const ui = { projectManager: { mapNotes: { list: () => [note], getWorkflowSummary: () => current } } };
  refreshMapNoteFilters(ui, root); assert.equal(card.hidden, false); assert.equal(count.textContent, '1 of 1 notes shown');
  current = { ...current, outstanding: 0, completed: 2 }; refreshMapNoteFilters(ui, root);
  assert.equal(card.hidden, true); assert.equal(card.selected, true); assert.equal(count.textContent, '0 of 1 notes shown');
  controls.task.value = 'unavailable'; ui.projectManager.mapNotes.getWorkflowSummary = () => { throw new Error('missing'); };
  refreshMapNoteFilters(ui, root); assert.equal(card.hidden, false);
});
