// A data-review workspace; contents are text, not instructions to execute.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const categories = ['other', 'classification', 'data-quality', 'editing-instruction', 'clarification', 'insight', 'validation', 'investigation'];
const statuses = ['open', 'in-review', 'resolved', 'archived'];
const label = value => value.replaceAll('-', ' ');
const options = (values, selected) => values.map(value => `<option value="${value}"${value === selected ? ' selected' : ''}>${escape(label(value))}</option>`).join('');

export function openDataMapNotesPanel(ui, { editId = null, target = null } = {}) {
  const registry = ui.projectManager.mapNotes;
  const selected = editId ? registry.get(editId) : null;
  if (editId && !selected) throw new Error('That Map Note no longer exists.');
  const current = selected?.target || target || { type: 'dataset' };
  const notes = registry.list();
  const fieldNotes = ui.projectManager.fieldNotes?.list() || [];
  const relationships = ui.projectManager.noteRelationships;
  const cards = notes.map(note => {
    const links = relationships?.list({ mapNoteId: note.id }) || [];
    const linked = links.map(link => { const field = fieldNotes.find(item => item.id === link.fieldNoteId); return `<li>${escape(label(link.type))}: ${escape(field?.title || (field ? 'Untitled Field Note' : 'Field Note unavailable'))} <button type="button" data-note-unlink="${escape(link.id)}">Unlink</button></li>`; }).join('');
    const choices = fieldNotes.map(field => `<option value="${escape(field.id)}">${escape(field.title || field.body.slice(0, 60) || 'Untitled Field Note')} (${escape(field.id)})</option>`).join('');
    return `<article class="map-note-card"><strong>${escape(note.title || 'Untitled Map Note')}</strong><p>${escape(note.body)}</p><small>${escape(label(note.category))} · ${escape(label(note.status))} · ${escape(note.target.type)}: ${escape(note.target.featureId || note.target.datasetId || note.target.sourceUrl || note.target.coordinates?.join(', ') || '')}</small><div class="map-note-card__actions"><button type="button" data-map-note-edit="${escape(note.id)}">Edit</button><button type="button" data-map-note-remove="${escape(note.id)}">Remove</button></div><details><summary>Related Field Notes (${links.length})</summary>${linked ? `<ul>${linked}</ul>` : '<p class="form-note">No linked Field Notes.</p>'}${choices ? `<label class="field"><span>Field Note</span><select data-note-field-choice="${escape(note.id)}"><option value="">Choose a Field Note</option>${choices}</select></label><label class="field"><span>Relationship</span><select data-note-link-type="${escape(note.id)}"><option value="related">Related</option><option value="supports">Supports this Map Note</option><option value="contradicts">Contradicts this Map Note</option></select></label><button type="button" data-note-link="${escape(note.id)}">Link Field Note</button>` : '<p class="form-note">Create a Field Note in this project to link it here.</p>'}<p class="form-note">Links stay in this project and do not change or share either note. If a note is removed, its link is retained as unavailable.</p></details></article>`;
  }).join('');
  const host = ui.openDataMapNotesWorkspace(`<div class="map-notes-panel"><p class="form-note">Map Notes record knowledge and review of geographic data. They do not modify a layer or authorize an AI action. Save the project to keep them.</p><section><h3>${selected ? 'Edit Map Note' : 'New Map Note'}</h3><div data-data-note-form><label class="field"><span>Target</span><select name="targetType">${options(['dataset', 'feature', 'service', 'location'], current.type)}</select></label><div data-target-dataset><label class="field"><span>Dataset ID</span><input name="datasetId" maxlength="256" value="${escape(current.datasetId || '')}" /></label></div><div data-target-feature><label class="field"><span>Feature ID</span><input name="featureId" maxlength="256" value="${escape(current.featureId || '')}" /></label></div><div data-target-service><label class="field"><span>Service URL</span><input name="sourceUrl" type="url" value="${escape(current.sourceUrl || '')}" placeholder="https://example.org/service" /></label><p class="form-note">Use a URL without credentials or access tokens.</p></div><div data-target-location><label class="field"><span>Longitude</span><input name="longitude" type="number" step="any" value="${escape(current.coordinates?.[0] ?? '')}" /></label><label class="field"><span>Latitude</span><input name="latitude" type="number" step="any" value="${escape(current.coordinates?.[1] ?? '')}" /></label></div><label class="field"><span>Category</span><select name="category">${options(categories, selected?.category || 'other')}</select></label><label class="field"><span>Title (optional)</span><input name="title" maxlength="240" value="${escape(selected?.title || '')}" /></label><label class="field"><span>Note</span><textarea name="body" rows="4" maxlength="20000">${escape(selected?.body || '')}</textarea></label><label class="field"><span>Tags (comma-separated)</span><input name="tags" value="${escape(selected?.tags.join(', ') || '')}" /></label><label class="field"><span>Review status</span><select name="status">${options(statuses, selected?.status || 'open')}</select></label><div class="map-note-card__actions"><button type="button" data-map-note-save class="button--primary">${selected ? 'Save changes' : 'Add Map Note'}</button>${selected ? '<button type="button" data-map-note-cancel>Cancel editing</button>' : ''}</div><p role="alert" data-map-note-error></p></div></section><section><h3>Data notes (${notes.length})</h3>${cards || '<p class="form-note">No data-review notes in this project yet.</p>'}</section></div>`);
  const form = host.querySelector('[data-data-note-form]');
  const read = name => form.querySelector(`[name="${name}"]`).value;
  const showTarget = () => {
    const type = read('targetType');
    form.querySelector('[data-target-dataset]').hidden = !['dataset', 'feature'].includes(type);
    form.querySelector('[data-target-feature]').hidden = type !== 'feature';
    form.querySelector('[data-target-service]').hidden = type !== 'service';
    form.querySelector('[data-target-location]').hidden = type !== 'location';
  };
  form.querySelector('[name="targetType"]').addEventListener('change', showTarget); showTarget();
  form.querySelector('[data-map-note-save]').addEventListener('click', event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      const type = read('targetType');
      const location = () => { const lon = read('longitude'), lat = read('latitude'); if (!lon.trim() || !lat.trim()) throw new Error('Enter both longitude and latitude.'); return [Number(lon), Number(lat)]; };
      const noteTarget = { type, ...(['dataset', 'feature'].includes(type) ? { datasetId: read('datasetId').trim() } : {}), ...(type === 'feature' ? { featureId: read('featureId').trim() } : {}), ...(type === 'service' ? { sourceUrl: read('sourceUrl').trim() } : {}), ...(type === 'location' ? { coordinates: location() } : {}), ...(['feature', 'dataset'].includes(type) && current.sourceUrl && read('datasetId').trim() === current.datasetId ? { sourceUrl: current.sourceUrl } : {}) };
      // Preserve additional valid target context when an edit does not retarget the note.
      const unchangedTarget = selected && type === current.type && (type === 'location'
        ? JSON.stringify(noteTarget.coordinates) === JSON.stringify(current.coordinates)
        : type === 'service' ? noteTarget.sourceUrl === current.sourceUrl
        : noteTarget.datasetId === current.datasetId && (type !== 'feature' || noteTarget.featureId === current.featureId));
      const tags = read('tags');
      const changes = { target: unchangedTarget ? current : noteTarget, category: read('category'), title: read('title'), body: read('body'), tags: selected && tags === selected.tags.join(', ') ? selected.tags : tags.split(',').map(tag => tag.trim()).filter(Boolean), status: read('status') };
      if (selected) registry.update(selected.id, changes); else registry.create(changes);
      ui.toast(`Map Note ${selected ? 'updated' : 'added'} in this project. Save the project to keep it.`);
      openDataMapNotesPanel(ui);
    } catch (error) { form.querySelector('[data-map-note-error]').textContent = `Not saved: ${error.message}`; button.disabled = false; }
  });
  host.querySelector('[data-map-note-cancel]')?.addEventListener('click', () => openDataMapNotesPanel(ui));
  host.querySelectorAll('[data-map-note-edit]').forEach(button => button.addEventListener('click', () => openDataMapNotesPanel(ui, { editId: button.dataset.mapNoteEdit })));
  host.querySelectorAll('[data-note-link]').forEach(button => button.addEventListener('click', () => {
    try {
      const card = button.closest('article');
      relationships.create({ mapNoteId: button.dataset.noteLink, fieldNoteId: card.querySelector('[data-note-field-choice]').value, type: card.querySelector('[data-note-link-type]').value });
      openDataMapNotesPanel(ui); ui.toast('Notes linked in this project. Save the project to keep the link.');
    } catch (error) { ui.error(`Could not link notes: ${error.message}`); }
  }));
  host.querySelectorAll('[data-note-unlink]').forEach(button => button.addEventListener('click', () => {
    try { relationships.remove(button.dataset.noteUnlink); openDataMapNotesPanel(ui); ui.toast('Notes unlinked. Save the project to keep the change.'); }
    catch (error) { ui.error(`Could not unlink notes: ${error.message}`); }
  }));
  host.querySelectorAll('[data-map-note-remove]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.confirm !== 'yes') { button.dataset.confirm = 'yes'; button.textContent = 'Confirm remove'; return; }
    try { registry.remove(button.dataset.mapNoteRemove); openDataMapNotesPanel(ui); ui.toast('Map Note removed. Save the project to keep this change.'); } catch (error) { ui.error(`Could not remove Map Note: ${error.message}`); }
  }));
}
