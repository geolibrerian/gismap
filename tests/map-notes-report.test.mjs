import test from 'node:test';
import assert from 'node:assert/strict';
import { createMapNotesReport, prepareMapNotesReport } from '../js/map-notes-report.js';
import { readFieldNoteHash } from '../js/field-note-link.js';

const base = 'https://gismap.online/';
const note = (id, body = 'A field observation') => ({ schemaVersion: '1.0', id, type: 'observation', title: 'Note', body, createdAt: '2026-10-18T00:00:00Z', updatedAt: '2026-10-18T00:00:00Z', anchor: { type: 'point', geometry: { type: 'Point', coordinates: [-122, 37] } }, relationships: [] });
const fakeQr = async () => ({ bytes: new Uint8Array([255, 216, 255, 217]), width: 1, height: 1 });

test('report links restore each observation without a server', () => {
  const entries = prepareMapNotesReport(base, null, [note('one'), note('two')]);
  assert.equal(readFieldNoteHash(new URL(entries[1].url).hash).notes[0].id, 'two');
});
test('25 notes produce 25 pages and a link and QR per observation', async () => {
  const progress = [];
  const blob = await createMapNotesReport(base, null, Array.from({ length: 25 }, (_, i) => note(`n${i}`)), { makeQr: fakeQr, onProgress: (n) => progress.push(n) });
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  assert.equal((pdf.match(/\/Type \/Page\b/g) || []).length, 25);
  assert.equal((pdf.match(/\/Subtype \/Image/g) || []).length, 25);
  assert.equal((pdf.match(/fieldNote=j1\./g) || []).length, 50);
  assert.equal(progress.at(-1), 25);
});
test('no PDF is produced for unsupported content, oversized links or QR failures', async () => {
  assert.throws(() => prepareMapNotesReport(base, null, [note('unicode', 'caf\u00e9')]), /non-ASCII/);
  assert.throws(() => prepareMapNotesReport(base, null, [note('large', 'x'.repeat(5000))]), /too large/);
  await assert.rejects(createMapNotesReport(base, null, [note('qr')], { makeQr: async () => null }), /QR/);
});
test('long words are split and continuation pages retain content', async () => {
  const word = 'x'.repeat(1200);
  const blob = await createMapNotesReport(base, null, [note('long', word)], { makeQr: fakeQr });
  const pdf = Buffer.from(await blob.arrayBuffer()).toString('latin1');
  const count = [...pdf.matchAll(/\((x+)\) Tj/g)].reduce((n, m) => n + m[1].length, 0);
  assert.equal(count, word.length);
});
