import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES_SCOPE, SiNotes, noteChip, statusHtml, wireSiNotes } from '../js/si-notes.js';

const WS = '11111111-1111-4111-8111-111111111111';
const note = (id = 'mn_1') => ({ kind: 'map-note', schemaVersion: '4.0', id, title: '', body: 'This parcel boundary is wrong', category: 'data-quality', tags: [], status: 'open', target: { type: 'feature', datasetId: 'd', featureId: '7' }, createdAt: '2026-11-17T09:00:00Z', updatedAt: '2026-11-17T09:00:00Z' });

function memoryStorage() { const data = new Map(); return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), data }; }
function connection({ scopes = ['stored:read', NOTES_SCOPE], connected = true, workspaces = [{ id: WS, name: 'Valley' }], statuses = [] } = {}) {
  const calls = [];
  return {
    calls, connected, can: scope => scopes.includes(scope), signIn: async () => { calls.push(['signIn']); },
    async request(path, options = {}) {
      calls.push([options.method || 'GET', path, options.body]);
      if (path === '/stored/workspaces') return { data: { workspaces } };
      if (path === '/ratatoskr/notes') return { status: 201, data: { id: 'q1', status: 'proposed', summary: 'Data edit proposed; waiting for an owner or admin to approve.', reply: null } };
      if (path.startsWith('/ratatoskr/notes/status')) return { data: { notes: statuses } };
      throw new Error(`unexpected ${path}`);
    },
  };
}

test('a note is sent only as it is stored, to the only workspace, and remembered without text or token', async () => {
  const conn = connection(), storage = memoryStorage(), notes = new SiNotes({ connection: conn, storage });
  const workspace = await notes.defaultWorkspace();
  const sent = await notes.send(note(), workspace, 'm_abcdefghijkl');
  assert.equal(sent.status, 'proposed');
  assert.deepEqual(conn.calls.at(-1), ['POST', '/ratatoskr/notes', { workspace_id: WS, note: note(), map_id: 'm_abcdefghijkl' }]);
  assert.deepEqual(JSON.parse(storage.data.get('gismap-online:si-notes:v1')), { mn_1: WS });
});

test('the open SI map decides the workspace; several workspaces leave the choice to the person', async () => {
  assert.equal(await new SiNotes({ connection: connection(), storage: null, workspaceId: () => 'fixed' }).defaultWorkspace(), 'fixed');
  const two = connection({ workspaces: [{ id: 'a' }, { id: 'b' }] });
  assert.equal(await new SiNotes({ connection: two, storage: null }).defaultWorkspace(), null);
});

test('statuses are asked only for notes that were sent, per workspace', async () => {
  const conn = connection({ statuses: [{ note_id: 'mn_1', status: 'done', summary: 'Refreshed by HUGINN' }] }), storage = memoryStorage();
  storage.setItem('gismap-online:si-notes:v1', JSON.stringify({ mn_1: WS }));
  const found = await new SiNotes({ connection: conn, storage }).statuses(['mn_1', 'mn_never_sent']);
  assert.equal(found.mn_1.summary, 'Refreshed by HUGINN');
  assert.deepEqual(conn.calls.map(c => c[1]), [`/ratatoskr/notes/status?workspace_id=${WS}&note_ids=mn_1`]);
});

test('status lines are text, never markup from SI', () => {
  const html = statusHtml({ status: 'rejected', summary: '<img src=x onerror=alert(1)>', reply: '<b>no</b>' });
  assert.match(html, /Declined/);
  assert.doesNotMatch(html, /<img|<b>/);
  assert.equal(noteChip('unknown-state').label, 'Sent');
});

function card(id = 'mn_1') {
  const line = { dataset: { siNoteStatus: id }, innerHTML: '', textContent: '' };
  const button = { dataset: { siNoteSend: id }, hidden: true, disabled: false, textContent: 'Send to SI bots', addEventListener(_type, handler) { this.click = handler; } };
  const host = { querySelectorAll: selector => selector === '[data-si-note-status]' ? [line] : selector === '[data-si-note-send]' ? [button] : [], querySelector: () => line };
  return { host, line, button };
}

test('nothing is offered or sent when the tab is not signed in to SI', () => {
  const { host, button } = card(), conn = connection({ connected: false });
  wireSiNotes(host, { siNotes: new SiNotes({ connection: conn, storage: null }), notes: () => [note()], setInterval: () => 0 });
  assert.equal(button.hidden, true);
  assert.deepEqual(conn.calls, []);
});

test('pressing Send sends that note and shows SI\'s status on it', async () => {
  const { host, line, button } = card(), conn = connection();
  wireSiNotes(host, { siNotes: new SiNotes({ connection: conn, storage: memoryStorage() }), notes: () => [note()], setInterval: () => 0 });
  assert.equal(button.hidden, false);
  assert.equal(conn.calls.filter(c => c[0] === 'POST').length, 0, 'opening the panel sends nothing');
  await button.click();
  assert.equal(conn.calls.filter(c => c[0] === 'POST').length, 1);
  assert.match(line.innerHTML, /waiting for approval/);
});

test('a connection without the notes permission asks to reconnect instead of sending', async () => {
  const { host, button } = card(), conn = connection({ scopes: ['stored:read'] });
  wireSiNotes(host, { siNotes: new SiNotes({ connection: conn, storage: null }), notes: () => [note()], signIn: conn.signIn, setInterval: () => 0 });
  assert.match(button.textContent, /Reconnect/);
  await button.click();
  assert.deepEqual(conn.calls, [['signIn']]);
});
