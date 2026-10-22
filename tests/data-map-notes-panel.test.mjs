import test from 'node:test';
import assert from 'node:assert/strict';
import { DataMapNotesRegistry } from '../js/data-map-notes.js';
import { openDataMapNotesPanel } from '../js/data-map-notes-panel.js';

function workspace(registry) {
  const controls = Object.fromEntries(['targetType', 'targetLabel', 'customCategory', 'datasetId', 'featureId', 'sourceUrl', 'longitude', 'latitude', 'category', 'title', 'body', 'tags', 'status'].map(name => [name, { value: '', addEventListener() {} }]));
  const save = { disabled: false, addEventListener(_type, handler) { this.click = () => handler({ currentTarget: this }); } };
  const error = { textContent: '' };
  const target = { hidden: false };
  const form = { querySelector(selector) { return selector.startsWith('[name=') ? controls[selector.match(/"(.*?)"/)[1]] : selector === '[data-map-note-save]' ? save : selector === '[data-map-note-error]' ? error : target; } };
  let html = '';
  const host = { querySelector: selector => selector === '[data-data-note-form]' ? form : null, querySelectorAll: () => [] };
  const ui = { projectManager: { mapNotes: registry }, openDataMapNotesWorkspace(content) { html = content; return host; }, toast() {}, error() {} };
  return { ui, controls, save, error, host, html: () => html };
}

test('workspace creates a data note and displays its text safely', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui);
  Object.assign(w.controls.targetType, { value: 'feature' }); w.controls.datasetId.value = 'parcels'; w.controls.featureId.value = '42';
  w.controls.body.value = '<img src=x onerror=alert(1)>'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
  w.save.click();
  assert.equal(registry.list()[0].target.featureId, '42');
  assert.match(w.html(), /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(w.html(), /<img src=x/);
});

test('editing keeps optional target context and unchanged tags', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project });
  const note = registry.create({ body: 'Review', tags: ['a,b'], target: { type: 'feature', datasetId: 'parcels', featureId: '42', coordinates: [-122, 37] } });
  const w = workspace(registry); openDataMapNotesPanel(w.ui, { editId: note.id });
  for (const [name, value] of Object.entries({ targetType: 'feature', datasetId: 'parcels', featureId: '42', body: 'Reviewed', tags: 'a,b', category: 'other', status: 'open' })) w.controls[name].value = value;
  w.save.click();
  assert.deepEqual(registry.get(note.id).target.coordinates, [-122, 37]); assert.deepEqual(registry.get(note.id).tags, ['a,b']);
});

test('location notes reject missing coordinates without writing', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui); w.controls.targetType.value = 'location'; w.save.click();
  assert.match(w.error.textContent, /both longitude and latitude/); assert.equal(registry.list().length, 0); assert.equal(w.save.disabled, false);
});

test('map target preserves a draft and can save a feature with its clicked location', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui); w.controls.title.value = 'Draft'; w.controls.body.value = 'Keep this text'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
  w.ui.setDataMapNoteTarget({ type: 'feature', datasetId: 'roads', featureId: '42', coordinates: [-122, 37] });
  assert.equal(w.controls.title.value, 'Draft'); assert.equal(w.controls.body.value, 'Keep this text');
  w.save.click(); assert.deepEqual(registry.list()[0].target, { type: 'feature', datasetId: 'roads', featureId: '42', coordinates: [-122, 37] });
});

test('custom category and target are saved as text', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui); Object.assign(w.controls.targetType, { value: 'custom' });
  w.controls.targetLabel.value = 'Bridge deck'; w.controls.category.value = 'custom'; w.controls.customCategory.value = 'Field audit'; w.controls.body.value = 'Inspect'; w.controls.status.value = 'open';
  w.save.click(); assert.equal(registry.list()[0].category, 'Field audit'); assert.equal(registry.list()[0].target.label, 'Bridge deck');
});

test('map coordinates display six decimals and store at most eight', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui); w.controls.body.value = 'Location'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
  const coordinates = [-84.53601837158203, 45.51043713898764]; const stored = [-84.53601837, 45.51043714];
  w.ui.setDataMapNoteTarget({ type: 'location', coordinates });
  assert.equal(w.controls.longitude.value, '-84.536018'); assert.equal(w.controls.latitude.value, '45.510437');
  w.save.click(); const note = registry.list()[0]; assert.deepEqual(note.target.coordinates, stored);
  openDataMapNotesPanel(w.ui, { editId: note.id });
  assert.match(w.html(), /value="-84\.536018"/); assert.match(w.html(), /value="45\.510437"/);
  Object.assign(w.controls.targetType, { value: 'location' }); w.controls.longitude.value = '-84.536018'; w.controls.latitude.value = '45.510437'; w.controls.body.value = 'Updated'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
  w.save.click(); assert.deepEqual(registry.get(note.id).target.coordinates, stored);
  openDataMapNotesPanel(w.ui, { editId: note.id }); w.controls.longitude.value = '-84.5'; w.controls.latitude.value = '45.510437'; w.controls.targetType.value = 'location'; w.controls.body.value = 'Updated'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
  w.save.click(); assert.deepEqual(registry.get(note.id).target.coordinates, [-84.5, 45.510437]);
});

test('map selection saves location and multiple related geographic and feature references', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui); w.controls.body.value = 'Review these features'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
  w.ui.setDataMapNoteTarget({ type: 'location', coordinates: [-84.53601837158203, 45.51043713898764] });
  w.ui.setDataMapNoteContext({ address: 'Main Street', geographies: [{ label: 'County', value: 'Example' }], features: [{ datasetId: 'roads', featureId: '1' }, { datasetId: 'parcels', featureId: '2' }] });
  w.save.click(); const note = registry.list()[0];
  assert.equal(note.schemaVersion, '4.0'); assert.deepEqual(note.target.coordinates, [-84.53601837, 45.51043714]);
  assert.equal(note.target.context.address, 'Main Street'); assert.equal(note.target.context.features.length, 2);
  assert.equal(note.target.context.geographies[0].value, 'Example');
});

test('session draft restores text and earlier map targets without saving a project note', () => {
  const previous = globalThis.sessionStorage; const values = new Map();
  globalThis.sessionStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  try {
    const project = { id: 'test-project', mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project });
    const w = workspace(registry); w.ui.projectManager.current = project; openDataMapNotesPanel(w.ui);
    w.controls.body.value = 'Unfinished thought'; w.controls.category.value = 'other'; w.controls.status.value = 'open';
    w.ui.setDataMapNoteTarget({ type: 'location', coordinates: [-120, 37] });
    w.ui.setDataMapNoteTarget({ type: 'location', coordinates: [-121, 38] });
    assert.equal(registry.list().length, 0); assert.equal(w.ui.dataMapNoteDraftStored, true);
    const snapshot = JSON.parse(values.get('gismap:map-note-draft:test-project'));
    assert.deepEqual(snapshot.history[0].coordinates, [-120, 37]); assert.equal(snapshot.fields.body, 'Unfinished thought');
    const reopened = workspace(registry); reopened.ui.projectManager.current = project; openDataMapNotesPanel(reopened.ui);
    assert.equal(reopened.controls.body.value, 'Unfinished thought'); assert.deepEqual(reopened.ui.dataMapNotePoint, [-121, 38]);
  } finally { if (previous === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previous; }
});

test('optional title is generated from the note and explicitly entered titles are preserved', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui); Object.assign(w.controls.targetType, { value: 'project' }); w.controls.body.value = 'Check the bridge. Another observation.'; w.controls.category.value = 'other'; w.controls.status.value = 'open'; w.save.click();
  assert.equal(registry.list()[0].title, 'Check the bridge.');
  const next = workspace(registry); openDataMapNotesPanel(next.ui); next.controls.targetType.value = 'project'; next.controls.title.value = 'Explicit title'; next.controls.category.value = 'other'; next.controls.status.value = 'open'; next.save.click();
  assert.equal(registry.list()[1].title, 'Explicit title');
});

test('composer prioritizes note text and progressively discloses map context', () => {
  const registry = new DataMapNotesRegistry({ project: () => ({ mapNotes: [] }) }); const w = workspace(registry); openDataMapNotesPanel(w.ui);
  const html = w.html(); assert.ok(html.indexOf('<span>Note</span>') < html.indexOf('<span>Title (optional)</span>'));
  assert.ok(html.indexOf('<span>Title (optional)</span>') < html.indexOf('data-map-note-context'));
  assert.match(html, /map-note-target-details/); assert.match(html, /map-note-filter-grid/);
});


test('switching composer and project notes preserves the in-memory draft', () => {
  const registry = new DataMapNotesRegistry({ project: () => ({ mapNotes: [] }) }); const w = workspace(registry);
  const composer = {}, browser = {}, review = {};
  const button = view => ({ dataset: { noteView: view }, setAttribute() {}, addEventListener(_type, handler) { this.click = handler; } });
  const compose = button('compose'), browse = button('browse');
  const original = w.host.querySelector;
  w.host.querySelector = selector => ({ '[data-note-composer]': composer, '[data-note-browser]': browser, '[data-note-review]': review }[selector] || original(selector));
  w.host.querySelectorAll = selector => selector === '[data-note-view]' ? [compose, browse] : [];
  openDataMapNotesPanel(w.ui); w.controls.body.value = 'Draft survives';
  browse.click(); assert.equal(composer.hidden, true); assert.equal(browser.hidden, false); assert.equal(w.controls.body.value, 'Draft survives');
  compose.click(); assert.equal(composer.hidden, false); assert.equal(browser.hidden, true); assert.equal(w.controls.body.value, 'Draft survives');
});

test('composer puts target and note before optional metadata', async () => {
  const registry = new DataMapNotesRegistry({ project: () => ({ mapNotes: [] }) }); const w = workspace(registry); openDataMapNotesPanel(w.ui);
  assert.match(w.html(), /<details class="studio-disclosure map-note-details"><summary>Details/);
  assert.ok(w.html().indexOf('name="body"') < w.html().indexOf('map-note-details'));
  assert.doesNotMatch(w.html(), /map-note-workspace-head/);
  assert.match(w.html(), /data-target-choice=/); assert.match(w.html(), /data-note-review/);
});

test('review shows escaped context and project tags are offered without adding them automatically', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project });
  registry.create({ body: 'Check this site', tags: ['survey'], target: { type: 'location', coordinates: [-87.9, 43.1], context: { address: '<Main St>', geographies: [{ label: 'County', value: 'Example' }] } } });
  const w = workspace(registry); openDataMapNotesPanel(w.ui);
  assert.match(w.html(), /data-suggested-tag="survey"/);
  assert.match(w.html(), /data-note-zoom=/);
  assert.match(w.html(), /&lt;Main St&gt;/);
  assert.doesNotMatch(w.html(), /<Main St>/);
  assert.equal(w.controls.tags.value, '');
});

test('clearing filters keeps task selection intact', () => {
  const project = { mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project }); const w = workspace(registry);
  const search = { value: 'bridge', addEventListener() {} }, radius = { value: '20', addEventListener() {} };
  const clear = { addEventListener(_type, handler) { this.click = handler; } };
  const selected = { checked: true, addEventListener() {} };
  const query = w.host.querySelector;
  w.host.querySelector = selector => selector === '[data-note-clear-filters]' ? clear : query(selector);
  w.host.querySelectorAll = selector => selector === '[data-map-note-filter]' ? [search, radius] : selector === '[data-task-select]' ? [selected] : [];
  openDataMapNotesPanel(w.ui); clear.click();
  assert.equal(search.value, ''); assert.equal(radius.value, ''); assert.equal(selected.checked, true);
});

test('composer progressively discloses map context and additional target types', () => {
  const registry = new DataMapNotesRegistry({ project: () => ({ mapNotes: [] }) }); const w = workspace(registry);
  openDataMapNotesPanel(w.ui);
  assert.match(w.html(), /class="map-note-composer-grid"/);
  assert.match(w.html(), /<details class="map-note-composer-context studio-disclosure"><summary>Map context<\/summary>/);
  assert.match(w.html(), /<details class="map-note-other-targets"/);
  assert.doesNotMatch(w.html(), /All target types/);
});

test('clearing a draft confirms, clears its session and marker, and preserves saved notes', () => {
  const previousStore = globalThis.sessionStorage, previousConfirm = globalThis.confirm, values = new Map();
  globalThis.sessionStorage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) };
  let accept = false; globalThis.confirm = () => accept;
  try {
    const project = { id: 'discard-test', mapNotes: [] }; const registry = new DataMapNotesRegistry({ project: () => project });
    registry.create({ body: 'Saved note', target: { type: 'project' } });
    const w = workspace(registry), discard = { addEventListener(_type, handler) { this.click = handler; } };
    const query = w.host.querySelector; w.host.querySelector = selector => selector === '[data-map-note-discard]' ? discard : query(selector);
    w.ui.projectManager.current = project; let refreshes = 0; w.ui.refreshDataMapNoteMarkers = () => refreshes++;
    openDataMapNotesPanel(w.ui); w.controls.body.value = 'Unsaved'; w.ui.setDataMapNoteTarget({ type: 'location', coordinates: [-87, 43] }); w.ui.dataMapNotePoint = [-87, 43];
    const revision = w.ui.dataMapNotePickRevision || 0;
    discard.click(); assert.ok(values.has('gismap:map-note-draft:discard-test')); assert.deepEqual(w.ui.dataMapNotePoint, [-87, 43]);
    accept = true; discard.click(); assert.equal(values.has('gismap:map-note-draft:discard-test'), false);
    assert.equal(w.ui.dataMapNotePoint, null); assert.ok(refreshes > 0); assert.ok(w.ui.dataMapNotePickRevision > revision);
    assert.equal(registry.list().length, 1); assert.equal(registry.list()[0].body, 'Saved note');
  } finally { if (previousStore === undefined) delete globalThis.sessionStorage; else globalThis.sessionStorage = previousStore; if (previousConfirm === undefined) delete globalThis.confirm; else globalThis.confirm = previousConfirm; }
});

test('draft location zoom uses the selected coordinates', async () => {
  const registry = new DataMapNotesRegistry({ project: () => ({ mapNotes: [] }) }); const w = workspace(registry);
  let zoomHandler, actual; const zoom = { addEventListener(_type, handler) { zoomHandler = handler; } };
  const context = { innerHTML: '', querySelector(selector) { return selector === '[data-draft-note-zoom]' ? zoom : null; }, querySelectorAll() { return []; } };
  const form = w.host.querySelector('[data-data-note-form]'), query = form.querySelector;
  form.querySelector = selector => selector === '[data-map-note-context]' ? context : query(selector);
  w.ui.mapController = { async setView(view) { actual = view; } };
  openDataMapNotesPanel(w.ui); w.ui.setDataMapNoteTarget({ type: 'location', coordinates: [-87.89899312, 43.11370322] });
  await zoomHandler(); assert.deepEqual(actual.center, [-87.89899312, 43.11370322]); assert.equal(actual.zoom, 15);
  assert.match(context.innerHTML, /Zoom to location/);
});

test('custom, feature, dataset and service inputs appear next to the target selector', () => {
  const registry = new DataMapNotesRegistry({ project: () => ({ mapNotes: [] }) }); const w = workspace(registry);
  const form = w.host.querySelector('[data-data-note-form]'), query = form.querySelector;
  const targets = Object.fromEntries(['custom', 'dataset', 'feature', 'service', 'location'].map(name => [name, { hidden: false }]));
  form.querySelector = selector => { const match = selector.match(/^\[data-target-(custom|dataset|feature|service|location)\]$/); return match ? targets[match[1]] : query(selector); };
  const handlers = []; w.controls.targetType.addEventListener = (event, handler) => { if (event === 'change') handlers.push(handler); }; const changed = () => handlers.forEach(handler => handler());
  openDataMapNotesPanel(w.ui);
  w.controls.targetType.value = 'custom'; changed(); assert.equal(targets.custom.hidden, false); assert.equal(targets.dataset.hidden, true);
  w.controls.targetType.value = 'feature'; changed(); assert.equal(targets.custom.hidden, true); assert.equal(targets.dataset.hidden, false); assert.equal(targets.feature.hidden, false);
  w.controls.targetType.value = 'service'; changed(); assert.equal(targets.service.hidden, false); assert.equal(targets.feature.hidden, true);
  const html = w.html(); assert.ok(html.indexOf('data-target-custom') < html.indexOf('<span>Note</span>')); assert.ok(html.indexOf('data-target-service') < html.indexOf('<span>Note</span>'));
});
