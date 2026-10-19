// Project-local links, separate from either note's content and never authority to act.
const TYPES = new Set(['related', 'supports', 'contradicts']);
function id(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error(`Invalid ${name}.`);
  return value;
}
export function normalizeNoteRelationship(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['schemaVersion', 'id', 'mapNoteId', 'fieldNoteId', 'type', 'createdAt'].includes(key))) throw new Error('Unsupported note relationship fields.');
  if (value.schemaVersion !== '1.0' || !TYPES.has(value.type)) throw new Error('Unsupported note relationship version or type.');
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid relationship date.');
  return { schemaVersion: '1.0', id: id(value.id, 'relationship ID'), mapNoteId: id(value.mapNoteId, 'Map Note ID'), fieldNoteId: id(value.fieldNoteId, 'Field Note ID'), type: value.type, createdAt: value.createdAt };
}
export function normalizeNoteRelationships(values) {
  if (!Array.isArray(values) || values.length > 10000) throw new Error('Invalid note relationships list.');
  const links = values.map(normalizeNoteRelationship), ids = new Set(), pairs = new Set();
  for (const link of links) {
    const pair = JSON.stringify([link.mapNoteId, link.fieldNoteId, link.type]);
    if (ids.has(link.id) || pairs.has(pair)) throw new Error('Duplicate note relationship.');
    ids.add(link.id); pairs.add(pair);
  }
  return links;
}
export class NoteRelationshipsRegistry {
  constructor({ project, events, persist = () => {} }) { Object.assign(this, { project, events, persist }); }
  list({ mapNoteId, fieldNoteId } = {}) { return structuredClone((this.project().noteRelationships || []).filter(link => (!mapNoteId || link.mapNoteId === mapNoteId) && (!fieldNoteId || link.fieldNoteId === fieldNoteId))); }
  commit(links, action, relationshipId) {
    const previous = this.project().noteRelationships;
    this.project().noteRelationships = normalizeNoteRelationships(links);
    try { this.persist(); } catch (error) { this.project().noteRelationships = previous; throw error; }
    this.events?.publish('note-relationships:changed', { action, relationshipId, count: links.length });
  }
  create({ mapNoteId, fieldNoteId, type = 'related' }) {
    const project = this.project();
    if (!(project.mapNotes || []).some(note => note.id === mapNoteId) || !(project.notes || []).some(note => note.id === fieldNoteId)) throw new Error('Both notes must exist in this project.');
    const link = normalizeNoteRelationship({ schemaVersion: '1.0', id: `nrel_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`, mapNoteId, fieldNoteId, type, createdAt: new Date().toISOString() });
    this.commit([...this.list(), link], 'create', link.id); return structuredClone(link);
  }
  remove(relationshipId) { const links = this.list(); if (!links.some(link => link.id === relationshipId)) return false; this.commit(links.filter(link => link.id !== relationshipId), 'remove', relationshipId); return true; }
}
