// Filters read the current project and never modify note tags or workflow state.
export function matchesMapNoteFilters(note, workflow, filters = {}) {
  const term = String(filters.search || '').trim().toLocaleLowerCase();
  const text = [note.title, note.body, note.category, note.status, note.target.type,
    note.target.datasetId, note.target.featureId, note.target.sourceUrl, note.target.label, note.target.context?.address, ...(note.target.context?.geographies || []).flatMap(item => [item.label, item.value]), ...(note.target.context?.features || []).flatMap(item => [item.datasetTitle, item.datasetId, item.featureId]), ...(note.tags || [])]
    .filter(Boolean).join(' ').toLocaleLowerCase();
  if (term && !text.includes(term)) return false;
  if (filters.scope && note.target.type !== filters.scope && !(filters.scope === 'feature' && note.target.context?.features?.some(item => item.featureId)) && !(filters.scope === 'dataset' && note.target.context?.features?.length)) return false;
  if (filters.category && note.category !== filters.category) return false;
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
    const filters = { search: value('search'), scope: value('scope'), category: value('category'), review: value('review'), task: value('task') };
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
