// Great-circle distance on a sphere, in miles; handles the antimeridian.
export function noteDistanceMiles(a, b) {
  if (![a, b].every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)) return null;
  const radians = Math.PI / 180, lat1 = a[1] * radians, lat2 = b[1] * radians;
  const dlat = lat2 - lat1, dlon = (b[0] - a[0]) * radians;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
// Filters read the current project and never modify note tags or workflow state.
export function matchesMapNoteFilters(note, workflow, filters = {}) {
  const term = String(filters.search || '').trim().toLocaleLowerCase();
  const text = [note.title, note.body, ...(note.categories || [note.category]), note.status, note.target.type,
    note.target.datasetId, note.target.featureId, note.target.sourceUrl, note.target.label, note.target.context?.address, ...(note.target.context?.geographies || []).flatMap(item => [item.label, item.value]), ...(note.target.context?.features || []).flatMap(item => [item.datasetTitle, item.datasetId, item.featureId]), ...(note.tags || [])]
    .filter(Boolean).join(' ').toLocaleLowerCase();
  if (term && !text.includes(term)) return false;
  if (filters.scope && note.target.type !== filters.scope && !(filters.scope === 'feature' && note.target.context?.features?.some(item => item.featureId)) && !(filters.scope === 'dataset' && note.target.context?.features?.length)) return false;
  if (filters.category && !(note.categories || [note.category]).includes(filters.category)) return false;
  if (filters.radius !== undefined && filters.radius !== '') {
    const radius = Number(filters.radius), distance = noteDistanceMiles(filters.center, note.target.coordinates);
    if (!Number.isFinite(radius) || radius <= 0 || radius > 12500 || distance === null || distance > radius) return false;
  }
  if (filters.review && note.status !== filters.review) return false;
  switch (filters.task) {
    case 'none': return workflow.taskCount === 0;
    case 'outstanding': return workflow.outstanding > 0;
    case 'awaiting-return': return workflow.completed > workflow.returned;
    case 'completed': return workflow.taskCount > 0 && workflow.completed === workflow.taskCount;
    case 'returned': return workflow.taskCount > 0 && workflow.returned === workflow.taskCount;
    case 'unavailable': return workflow.missing > 0 || workflow.unknown > 0;
    default: return true;
  }
}

// Refresh in place: selection and unfinished editor input must survive updates.
export function refreshMapNoteFilters(ui, root = globalThis.document) {
  if (!root || !ui.projectManager?.mapNotes) return;
  for (const host of root.querySelectorAll('[data-map-note-filter-panel]')) {
    const value = name => host.querySelector(`[data-map-note-filter="${name}"]`)?.value || '';
    const filters = { search: value('search'), scope: value('scope'), category: value('category'), review: value('review'), task: value('task'), radius: value('radius'), center: ui.mapNoteFilterCenter };
    const notes = new Map(ui.projectManager.mapNotes.list().map(note => [note.id, note]));
    let visible = 0;
    host.querySelectorAll('[data-map-note-id]').forEach(card => {
      const note = notes.get(card.dataset.mapNoteId);
      if (!note) { card.hidden = true; return; }
      let summary;
      try { summary = ui.projectManager.mapNotes.getWorkflowSummary(note.id); }
      catch { summary = { taskCount: null, completed: 0, returned: 0, outstanding: 0, missing: 1, unknown: 0 }; }
      card.hidden = !matchesMapNoteFilters(note, summary, filters);
      if (!card.hidden) visible++;
    });
    const count = host.querySelector('[data-map-note-visible-count]');
    if (count) count.textContent = `${visible} of ${notes.size} notes shown`;
  }
}
