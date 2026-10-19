// Relationship views update in place so an unsaved note draft is not discarded.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const display = note => note.title || note.body?.slice(0, 60) || 'Untitled note';
const descriptions = { related: 'Related', supports: 'Field Note supports Map Note', contradicts: 'Field Note contradicts Map Note' };

export function refreshNoteRelationships(ui) {
  const manager = ui.projectManager, registry = manager.noteRelationships;
  if (!registry || typeof document === 'undefined') return;
  const fields = manager.fieldNotes.list(), maps = manager.mapNotes.list(), links = registry.list();
  for (const pane of document.querySelectorAll('[data-field-note-links], [data-data-note-links]')) {
    const isField = pane.hasAttribute('data-field-note-links');
    const id = isField ? pane.dataset.fieldNoteLinks : pane.dataset.dataNoteLinks;
    const related = links.filter(link => isField ? link.fieldNoteId === id : link.mapNoteId === id);
    const others = isField ? maps : fields;
    const list = related.map(link => {
      const otherId = isField ? link.mapNoteId : link.fieldNoteId;
      const note = others.find(item => item.id === otherId);
      return `<li><strong>${escape(descriptions[link.type])}</strong>: ${escape(note ? display(note) : `${isField ? 'Map' : 'Field'} Note unavailable`)}${note?.body ? `<p>${escape(note.body)}</p>` : ''} <button type="button" data-unlink-note="${escape(link.id)}">Unlink</button></li>`;
    }).join('');
    const choices = others.map(note => `<option value="${escape(note.id)}">${escape(display(note))} (${escape(note.id)})</option>`).join('');
    pane.innerHTML = `<summary>Related ${isField ? 'Map' : 'Field'} Notes (${related.length})</summary>${list ? `<ul>${list}</ul>` : '<p class="form-note">No linked notes.</p>'}${choices ? `<label class="field"><span>${isField ? 'Map' : 'Field'} Note</span><select data-link-choice><option value="">Choose a note</option>${choices}</select></label><label class="field"><span>Relationship</span><select data-link-type><option value="related">Related</option><option value="supports">Field Note supports Map Note</option><option value="contradicts">Field Note contradicts Map Note</option></select></label><button type="button" data-link-note>Link notes</button>` : `<p class="form-note">Create a ${isField ? 'Map' : 'Field'} Note in this project to link it here.</p>`}<p class="form-note">Links stay in this project; field exports do not include them. Missing notes remain unavailable until restored.</p>`;
    pane.querySelector('[data-link-note]')?.addEventListener('click', () => {
      const otherId = pane.querySelector('[data-link-choice]').value;
      try {
        registry.create({ mapNoteId: isField ? otherId : id, fieldNoteId: isField ? id : otherId, type: pane.querySelector('[data-link-type]').value });
        ui.toast('Notes linked in this project. Save the project to keep the link.');
      } catch (error) { ui.error(`Could not link notes: ${error.message}`); }
    });
    pane.querySelectorAll('[data-unlink-note]').forEach(button => button.addEventListener('click', () => {
      try { registry.remove(button.dataset.unlinkNote); ui.toast('Notes unlinked. Save the project to keep the change.'); }
      catch (error) { ui.error(`Could not unlink notes: ${error.message}`); }
    }));
  }
}
