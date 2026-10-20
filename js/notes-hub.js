// Compact, project-scoped overview; editing and exports remain in their existing workflows.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export function renderNotesHub({ projectName, mapNotes = [], fieldNotes = [], tasks = [], tab = 'map' }) {
  const groups = { map: mapNotes, field: fieldNotes, tasks };
  if (!(tab in groups)) tab = 'map';
  const labels = { map: 'Map Notes', field: 'Field Notes', tasks: 'Field Tasks' };
  const items = groups[tab];
  const cards = items.map(item => `<button type="button" class="notes-hub__item" data-notes-hub="item" data-id="${escape(item.id)}"><strong>${escape(item.title || item.body || item.notes || `Untitled ${labels[tab].slice(0, -1)}`)}</strong><small>${escape(item.status || item.type || (tab === 'map' ? 'Map note' : 'Observation'))}</small></button>`).join('');
  return `<div class="notes-hub__project"><span>Current project</span><strong>${escape(projectName || 'Untitled project')}</strong><button type="button" data-notes-hub="projects">Change project</button></div><nav class="notes-hub__tabs" aria-label="Notes and tasks">${Object.entries(labels).map(([key, label]) => `<button type="button" data-notes-hub="tab" data-tab="${key}" aria-pressed="${tab === key}">${label}<span>${groups[key].length}</span></button>`).join('')}</nav><div class="notes-hub__list">${cards || `<p class="notes-hub__empty">No ${labels[tab].toLowerCase()} in this project yet.</p>`}</div><div class="notes-hub__actions"><button type="button" data-notes-hub="workspace">${tab === 'map' ? 'Edit / search Map Notes' : tab === 'field' ? 'Open Field Notes' : 'Open Field Tasks'}</button><button type="button" data-notes-hub="qr">Open photo or QR card…</button><button type="button" data-notes-hub="pdf" ${fieldNotes.length ? '' : 'disabled'}>Create Field Notes PDF…</button></div>`;
}
