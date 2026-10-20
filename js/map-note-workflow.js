// Read-only projection: task state is not written into notes or tags.
export function summarizeMapNoteWorkflow(project, mapNoteId) {
  const linked = new Set((project.noteRelationships || []).filter(link => link.schemaVersion === '2.0' && link.relation === 'requests_verification' && link.source?.type === 'map-note' && link.source.id === mapNoteId && link.target?.type === 'field-task').map(link => link.target.id));
  const tasks = new Map((project.mobile?.fieldTasks || []).map(task => [task.id, task]));
  let completed = 0, returned = 0, outstanding = 0, missing = 0, unknown = 0;
  for (const id of linked) {
    const task = tasks.get(id);
    if (!task) { missing++; continue; }
    if (task.status === 'returned') { returned++; completed++; }
    else if (task.status === 'completed') completed++;
    else if (['draft', 'sent', 'assigned', 'shared', 'in-progress'].includes(task.status)) outstanding++;
    else unknown++;
  }
  const indicators = [];
  if (linked.size) indicators.push('task-created');
  if (outstanding) indicators.push('task-outstanding');
  if (linked.size && completed === linked.size) indicators.push('task-completed');
  if (linked.size && returned === linked.size) indicators.push('task-returned');
  if (completed > returned) indicators.push('awaiting-return');
  return { taskCount: linked.size, completed, returned, outstanding, missing, unknown, indicators };
}
