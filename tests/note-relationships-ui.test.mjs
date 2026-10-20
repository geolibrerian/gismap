import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshNoteRelationships } from '../js/note-relationships-ui.js';
import { NoteRelationshipsRegistry } from '../js/note-relationships.js';
import { EventBus } from '../js/events.js';

function pane(kind, id) {
  const handlers = {};
  const choices = { value: '' }, type = { value: 'related' };
  return { dataset: kind === 'field' ? { fieldNoteLinks: id } : { dataNoteLinks: id }, open: true, innerHTML: '', handlers, choices, type,
    hasAttribute: key => key === (kind === 'field' ? 'data-field-note-links' : 'data-data-note-links'),
    querySelector: key => key === '[data-link-choice]' ? choices : key === '[data-link-type]' ? type : key === '[data-link-note]' ? { addEventListener: (_event, fn) => { handlers.link = fn; } } : null,
    querySelectorAll: () => [],
  };
}

test('both views refresh on link changes without replacing drafts, and escape note text', () => {
  const project = { notes: [{ id: 'field', title: 'A field visit', body: 'Observed' }], mapNotes: [{ id: 'map', title: '<img src=x>', body: 'Review & verify' }], noteRelationships: [] };
  const events = new EventBus(); const registry = new NoteRelationshipsRegistry({ project: () => project, events });
  const fieldPane = pane('field', 'field'), mapPane = pane('map', 'map');
  const previous = globalThis.document; globalThis.document = { querySelectorAll: () => [fieldPane, mapPane] };
  try {
    const ui = { projectManager: { fieldNotes: { list: () => project.notes }, mapNotes: { list: () => project.mapNotes }, noteRelationships: registry }, toast() {}, error(message) { throw new Error(message); } };
    const draft = { value: 'unfinished draft' };
    events.subscribe('note-relationships:changed', () => refreshNoteRelationships(ui));
    refreshNoteRelationships(ui);
    assert.match(fieldPane.innerHTML, /&lt;img src=x&gt;/); assert.doesNotMatch(fieldPane.innerHTML, /<img src=x>/);
    fieldPane.choices.value = 'map'; fieldPane.type.value = 'supports'; fieldPane.handlers.link();
    assert.equal(registry.list()[0].type, 'supports');
    assert.match(fieldPane.innerHTML, /Related Map Notes \(1\)/); assert.match(mapPane.innerHTML, /Related Field Notes \(1\)/);
    assert.match(fieldPane.innerHTML, /Review &amp; verify/); assert.equal(fieldPane.open, true); assert.equal(draft.value, 'unfinished draft');
    project.mapNotes = []; refreshNoteRelationships(ui); assert.match(fieldPane.innerHTML, /Map Note unavailable/);
  } finally { globalThis.document = previous; }
});
