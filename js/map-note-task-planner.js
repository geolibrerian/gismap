import { normalizeNoteRelationships } from './note-relationships.js?v=0.2.0';

const uid = prefix => `${prefix}_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;
const openTask = task => !task || !['completed', 'returned'].includes(task.status);
function outstanding(project, noteId) {
  const tasks = new Map((project.mobile?.fieldTasks || []).map(task => [task.id, task]));
  return (project.noteRelationships || []).some(link => link.schemaVersion === '2.0' && link.relation === 'requests_verification' && link.source?.type === 'map-note' && link.source.id === noteId && link.target?.type === 'field-task' && openTask(tasks.get(link.target.id)));
}
function inputs(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !['mapNoteIds', 'strategy', 'skipOutstanding'].includes(key))) throw new Error('Invalid task generation options.');
  const { mapNoteIds, strategy = 'one-per-note', skipOutstanding = true } = request;
  if (!Array.isArray(mapNoteIds) || !mapNoteIds.length || mapNoteIds.length > 100 || mapNoteIds.some(id => typeof id !== 'string' || !id || id.length > 128) || new Set(mapNoteIds).size !== mapNoteIds.length) throw new Error('Select between 1 and 100 distinct Map Notes.');
  if (!['one-per-note', 'combined'].includes(strategy) || typeof skipOutstanding !== 'boolean') throw new Error('Invalid task generation strategy.');
  return { mapNoteIds: [...mapNoteIds], strategy, skipOutstanding };
}
function fingerprint(project) {
  return JSON.stringify([project.id, project.mapNotes, project.mobile?.fieldTasks, project.noteRelationships]);
}
export function previewMapNoteTasks(project, request) {
  const options = inputs(request), notesById = new Map((project.mapNotes || []).map(note => [note.id, note]));
  const selected = options.mapNoteIds.map(id => { const note = notesById.get(id); if (!note) throw new Error('A selected Map Note no longer exists.'); return note; });
  const skipped = selected.filter(note => options.skipOutstanding && outstanding(project, note.id));
  const included = selected.filter(note => !skipped.includes(note));
  const groups = options.strategy === 'combined' && included.length ? [included] : included.map(note => [note]);
  const tasks = groups.map(group => {
    const title = group.length === 1 ? (group[0].title.trim() || 'Verify Map Note') : `Verify ${group.length} Map Notes`;
    const instructions = group.map(note => group.length === 1 ? (note.body || note.title) : `${note.title || 'Map Note'}: ${note.body || note.title}`).join('\n\n');
    if (title.length > 120 || instructions.length > 500) throw new Error('A task title or combined instructions exceed Field Task limits (120 and 500 characters). Shorten the source notes or use one task per note.');
    const coordinates = group.length === 1 ? group[0].target.coordinates : null;
    return { title, instructions, mapNoteIds: group.map(note => note.id), ...(coordinates ? { longitude: coordinates[0], latitude: coordinates[1] } : {}) };
  });
  return { projectId: project.id, options, fingerprint: fingerprint(project), tasks, skipped: skipped.map(note => ({ id: note.id, title: note.title || 'Untitled Map Note' })) };
}
export function prepareMapNoteTasks(project, preview) {
  if (!preview || project.id !== preview.projectId || typeof preview.fingerprint !== 'string' || fingerprint(project) !== preview.fingerprint) throw new Error('The project changed since preview. Preview again before creating tasks.');
  const current = previewMapNoteTasks(project, preview.options);
  if (JSON.stringify(current.tasks) !== JSON.stringify(preview.tasks) || JSON.stringify(current.skipped) !== JSON.stringify(preview.skipped)) throw new Error('The task preview changed. Preview again.');
  if (!current.tasks.length) throw new Error('No tasks to create; all selected notes were skipped.');
  const now = new Date().toISOString();
  const tasks = current.tasks.map(task => ({ id: uid('task'), title: task.title, notes: task.instructions, status: 'draft', role: 'author', steps: [], features: [], createdAt: now, updatedAt: now, ...(task.longitude != null ? { latitude: task.latitude, longitude: task.longitude } : {}) }));
  const links = current.tasks.flatMap((task, index) => task.mapNoteIds.map(id => ({ schemaVersion: '2.0', id: uid('nrel'), source: { type: 'map-note', id }, target: { type: 'field-task', id: tasks[index].id }, relation: 'requests_verification', createdAt: now })));
  const allLinks = normalizeNoteRelationships([...(project.noteRelationships || []), ...links]);
  const existing = new Set((project.mobile?.fieldTasks || []).map(task => task.id));
  for (const task of tasks) { if (existing.has(task.id)) throw new Error('Duplicate task ID. Preview again.'); existing.add(task.id); }
  return { tasks, links: allLinks };
}
