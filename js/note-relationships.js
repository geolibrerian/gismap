// Project-local links, separate from either note's content and never authority to act.
const TYPES = new Set(['related', 'supports', 'contradicts']);
// Canonical directions; inverse labels are a view, not a second stored edge.
const WORKFLOW_TYPES = Object.freeze({
  requests_verification: { source: 'map-note', target: 'field-task', inverse: 'investigates' },
  produced_observation: { source: 'field-task', target: 'field-note', inverse: 'fulfills' },
  requires_followup: { source: 'field-note', target: 'field-task', inverse: 'follows_up' },
});
function id(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 128) throw new Error(`Invalid ${name}.`);
  return value;
}
export function normalizeNoteRelationship(value) {
  if (value?.schemaVersion === '2.0') return normalizeWorkflowRelationship(value);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['schemaVersion', 'id', 'mapNoteId', 'fieldNoteId', 'type', 'createdAt'].includes(key))) throw new Error('Unsupported note relationship fields.');
  if (value.schemaVersion !== '1.0' || !TYPES.has(value.type)) throw new Error('Unsupported note relationship version or type.');
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid relationship date.');
  return { schemaVersion: '1.0', id: id(value.id, 'relationship ID'), mapNoteId: id(value.mapNoteId, 'Map Note ID'), fieldNoteId: id(value.fieldNoteId, 'Field Note ID'), type: value.type, createdAt: value.createdAt };
}
function reference(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['type', 'id'].includes(key)) || !['map-note', 'field-note', 'field-task'].includes(value.type)) throw new Error('Invalid workflow record reference.');
  return { type: value.type, id: id(value.id, 'record ID') };
}
function normalizeWorkflowRelationship(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['schemaVersion', 'id', 'source', 'target', 'relation', 'createdAt', 'creator', 'explanation'].includes(key))) throw new Error('Unsupported workflow relationship fields.');
  const source = reference(value.source), target = reference(value.target), rule = WORKFLOW_TYPES[value.relation];
  if (!rule || source.type !== rule.source || target.type !== rule.target) throw new Error('Invalid workflow relationship direction or type.');
  if (typeof value.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.createdAt) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid relationship date.');
  const result = { schemaVersion: '2.0', id: id(value.id, 'relationship ID'), source, target, relation: value.relation, createdAt: value.createdAt };
  for (const [key, max] of [['creator', 120], ['explanation', 2000]]) {
    if (value[key] != null) { if (typeof value[key] !== 'string' || value[key].length > max) throw new Error(`Invalid relationship ${key}.`); result[key] = value[key]; }
  }
  return result;
}
function edge(link) {
  return link.schemaVersion === '1.0' ? { source: { type: 'field-note', id: link.fieldNoteId }, target: { type: 'map-note', id: link.mapNoteId }, relation: link.type } : { source: link.source, target: link.target, relation: link.relation };
}
export function normalizeNoteRelationships(values) {
  if (!Array.isArray(values) || values.length > 10000) throw new Error('Invalid note relationships list.');
  const links = values.map(normalizeNoteRelationship), ids = new Set(), pairs = new Set();
  for (const link of links) {
    const pair = JSON.stringify(edge(link));
    if (ids.has(link.id) || pairs.has(pair)) throw new Error('Duplicate note relationship.');
    ids.add(link.id); pairs.add(pair);
  }
  return links;
}
export class NoteRelationshipsRegistry {
  constructor({ project, events, persist = () => {} }) { Object.assign(this, { project, events, persist }); }
  list({ mapNoteId, fieldNoteId } = {}) { return structuredClone((this.project().noteRelationships || []).filter(link => (!mapNoteId || link.mapNoteId === mapNoteId) && (!fieldNoteId || link.fieldNoteId === fieldNoteId))); }
  // Derived indexes are rebuilt from the authoritative project so imports and
  // project switches cannot leave an independent cache out of date.
  getRelated(record) {
    const requested = reference(record), index = new Map();
    for (const link of this.list()) {
      const e = edge(link);
      for (const [from, to, direction] of [[e.source, e.target, 'outgoing'], [e.target, e.source, 'incoming']]) {
        const key = JSON.stringify([from.type, from.id]);
        if (!index.has(key)) index.set(key, []);
        index.get(key).push({ relationship: link, record: to, direction, label: direction === 'outgoing' ? e.relation : (WORKFLOW_TYPES[e.relation]?.inverse || ({ supports: 'supported_by', contradicts: 'contradicted_by', related: 'related' })[e.relation]) });
      }
    }
    return structuredClone(index.get(JSON.stringify([requested.type, requested.id])) || []);
  }
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
  link(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !['source', 'target', 'relation', 'creator', 'explanation'].includes(key))) throw new Error('Unsupported workflow relationship input.');
    const { source, target, relation, creator, explanation } = input;
    const link = normalizeWorkflowRelationship({ schemaVersion: '2.0', id: `nrel_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`, source, target, relation, createdAt: new Date().toISOString(), ...(creator != null ? { creator } : {}), ...(explanation != null ? { explanation } : {}) });
    const project = this.project();
    const exists = ref => (ref.type === 'map-note' ? project.mapNotes : ref.type === 'field-note' ? project.notes : project.mobile?.fieldTasks)?.some(record => record.id === ref.id);
    if (!exists(link.source) || !exists(link.target)) throw new Error('Both workflow records must exist in this project.');
    this.commit([...this.list(), link], 'create', link.id); return structuredClone(link);
  }
  remove(relationshipId) { const links = this.list(); if (!links.some(link => link.id === relationshipId)) return false; this.commit(links.filter(link => link.id !== relationshipId), 'remove', relationshipId); return true; }
}
