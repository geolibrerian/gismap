import { refreshMapNoteFilters } from './map-note-filters.js?v=0.2.0';
import { refreshMapNoteWorkflow } from './map-note-workflow-ui.js?v=0.1.0';
import { refreshNoteRelationships } from './note-relationships-ui.js?v=0.1.0';
// A data-review workspace; contents are text, not instructions to execute.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const categories = ['other', 'classification', 'data-quality', 'editing-instruction', 'clarification', 'insight', 'validation', 'investigation'];
const statuses = ['open', 'in-review', 'resolved', 'archived'];
const label = value => value.replaceAll('-', ' ');
const options = (values, selected) => values.map(value => `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label(value))}</option>`).join('');

export function openDataMapNotesPanel(ui, { editId = null, target = null } = {}) {
  const registry = ui.projectManager.mapNotes;
  const selected = editId ? registry.get(editId) : null;
  if (editId && !selected) throw new Error('That Map Note no longer exists.');
  let current = selected?.target || target || { type: 'project' };
  const notes = registry.list();
  const cards = notes.map(note => `<article class="map-note-card" data-map-note-id="${escape(note.id)}" data-map-note-searchable="${escape([note.title, note.body, note.category, note.target.type, note.target.datasetId, note.target.featureId, ...note.tags].filter(Boolean).join(' '))}"><label><input type="checkbox" data-task-select="${escape(note.id)}" aria-label="Select ${escape(note.title || 'Map Note')} for field tasks" /> <strong>${escape(note.title || 'Untitled Map Note')}</strong></label><p>${escape(note.body)}</p><small>${escape(label(note.category))} · ${escape(label(note.status))} · ${escape(note.target.type)}${note.target.type === 'project' ? '' : `: ${escape(note.target.label || note.target.featureId || note.target.datasetId || note.target.sourceUrl || note.target.coordinates?.join(', ') || '')}`} </small>${note.tags.length ? `<p class="form-note">Tags: ${escape(note.tags.join(', '))}</p>` : ''}<p class="form-note" data-note-workflow="${escape(note.id)}"></p><div class="map-note-card__actions"><button type="button" data-map-note-edit="${escape(note.id)}">Edit</button><button type="button" data-map-note-remove="${escape(note.id)}">Remove</button></div><details data-data-note-links="${escape(note.id)}"></details></article>`).join('');
  const host = ui.openDataMapNotesWorkspace(`<div class="map-notes-panel"><p class="form-note">Click the map to choose a location or feature for this note. Map Notes do not modify a layer or authorize an AI action. Save the project to keep them.</p><section><h3>${selected ? 'Edit Map Note' : 'New Map Note'}</h3><div data-data-note-form><label class="field"><span>Target</span><select name="targetType">${options(['project', 'dataset', 'feature', 'service', 'location', 'custom'], current.type)}</select></label><p class="form-note" data-map-note-pick-status>Click the map to set the target; text already entered will be kept.</p><div data-target-custom><label class="field"><span>Custom target</span><input name="targetLabel" maxlength="256" value="${escape(current.label || '')}" placeholder="Describe the target" /></label></div><div data-target-dataset><label class="field"><span>Dataset ID</span><input name="datasetId" maxlength="256" value="${escape(current.datasetId || '')}" /></label></div><div data-target-feature><label class="field"><span>Feature ID</span><input name="featureId" maxlength="256" value="${escape(current.featureId || '')}" /></label></div><div data-target-service><label class="field"><span>Service URL</span><input name="sourceUrl" type="url" value="${escape(current.sourceUrl || '')}" placeholder="https://example.org/service" /></label><p class="form-note">Use a URL without credentials or access tokens.</p></div><div data-target-location><label class="field"><span>Longitude</span><input name="longitude" type="number" step="any" value="${escape(current.coordinates?.[0] ?? '')}" /></label><label class="field"><span>Latitude</span><input name="latitude" type="number" step="any" value="${escape(current.coordinates?.[1] ?? '')}" /></label></div><label class="field"><span>Category</span><select name="category">${options([...categories, 'custom'], categories.includes(selected?.category || 'other') ? (selected?.category || 'other') : 'custom')}</select></label><div data-custom-category><label class="field"><span>Custom category</span><input name="customCategory" maxlength="80" value="${escape(selected && !categories.includes(selected.category) ? selected.category : '')}" /></label></div><label class="field"><span>Title (optional)</span><input name="title" maxlength="240" value="${escape(selected?.title || '')}" /></label><label class="field"><span>Note</span><textarea name="body" rows="4" maxlength="20000">${escape(selected?.body || '')}</textarea></label><label class="field"><span>Tags (comma-separated)</span><input name="tags" value="${escape(selected?.tags.join(', ') || '')}" /></label><label class="field"><span>Review status</span><select name="status">${options(statuses, selected?.status || 'open')}</select></label><div class="map-note-card__actions"><button type="button" data-map-note-save class="button--primary">${selected ? 'Save changes' : 'Add Map Note'}</button>${selected ? '<button type="button" data-map-note-cancel>Cancel editing</button>' : ''}</div><p role="alert" data-map-note-error></p></div></section><section data-map-note-filter-panel><h3>Project Map Notes (${notes.length})</h3><label class="field"><span>Search notes</span><input type="search" data-map-note-filter="search" placeholder="Search title, text, dataset, feature, or tag" /></label><details><summary>Filter notes</summary><label class="field"><span>Scope</span><select data-map-note-filter="scope"><option value="">All scopes</option>${options(['project', 'dataset', 'feature', 'service', 'location', 'custom'])}</select></label><label class="field"><span>Category</span><select data-map-note-filter="category"><option value="">All categories</option>${options([...new Set([...categories, ...notes.map(note => note.category)])])}</select></label><label class="field"><span>Note review status</span><select data-map-note-filter="review"><option value="">All review statuses</option>${options(statuses)}</select></label><label class="field"><span>Linked field tasks</span><select data-map-note-filter="task"><option value="">All task statuses</option><option value="none">No linked tasks</option><option value="outstanding">Outstanding</option><option value="awaiting-return">Reported complete, awaiting return</option><option value="completed">All reported complete</option><option value="returned">All reported returned</option><option value="unavailable">Unavailable or unknown</option></select></label><p class="form-note">Task filters use reported task statuses, not verified events. Completing a task does not resolve the Map Note.</p></details><p class="form-note" data-map-note-visible-count></p>${notes.length ? `<div class="map-note-card__actions"><button type="button" data-task-select-visible>Select visible</button><button type="button" data-task-clear-selection>Clear selection</button></div><p data-task-selection-count>0 notes selected</p><p class="form-note">Searching or filtering does not clear selected notes, including notes hidden from view.</p><label class="field"><span>Task grouping</span><select data-task-strategy><option value="one-per-note">One task per note</option><option value="combined">One combined task</option></select></label><label><input type="checkbox" data-task-skip checked /> Skip notes with outstanding or unavailable tasks</label><div class="map-note-card__actions"><button type="button" data-task-preview>Preview field tasks</button></div><div data-task-preview-result role="status"></div>` : ''}${cards || '<p class="form-note">No data-review notes in this project yet.</p>'}</section></div>`);
  refreshNoteRelationships(ui);
  refreshMapNoteWorkflow(ui);
  host.querySelectorAll('[data-map-note-filter]').forEach(control => { control.addEventListener('input', () => refreshMapNoteFilters(ui, host)); control.addEventListener('change', () => refreshMapNoteFilters(ui, host)); });
  refreshMapNoteFilters(ui, host);
  let taskPreview = null;
  const selection = () => [...host.querySelectorAll('[data-task-select]')].filter(input => input.checked).map(input => input.dataset.taskSelect);
  const invalidate = () => { taskPreview = null; const result = host.querySelector('[data-task-preview-result]'); if (result) result.textContent = ''; const count = host.querySelector('[data-task-selection-count]'); if (count) count.textContent = `${selection().length} notes selected`; };
  host.querySelectorAll('[data-task-select]').forEach(input => input.addEventListener('change', invalidate));
  host.querySelector('[data-task-strategy]')?.addEventListener('change', invalidate);
  host.querySelector('[data-task-skip]')?.addEventListener('change', invalidate);
  host.querySelector('[data-task-select-visible]')?.addEventListener('click', () => { host.querySelectorAll('[data-task-select]').forEach(input => { if (!input.closest('article').hidden) input.checked = true; }); invalidate(); });
  host.querySelector('[data-task-clear-selection]')?.addEventListener('click', () => { host.querySelectorAll('[data-task-select]').forEach(input => { input.checked = false; }); invalidate(); });
  host.querySelector('[data-task-preview]')?.addEventListener('click', () => {
    const result = host.querySelector('[data-task-preview-result]');
    try {
      taskPreview = ui.projectManager.previewTasksFromMapNotes({ mapNoteIds: selection(), strategy: host.querySelector('[data-task-strategy]').value, skipOutstanding: host.querySelector('[data-task-skip]').checked });
      result.innerHTML = `<p><strong>Preview: ${taskPreview.tasks.length} draft task(s), ${taskPreview.skipped.length} skipped</strong></p><ul>${taskPreview.tasks.map(task => `<li><strong>${escape(task.title)}</strong> · ${task.mapNoteIds.length} note(s)${task.latitude != null ? ` · ${escape(task.latitude)}, ${escape(task.longitude)}` : ' · no location'}<p>${escape(task.instructions)}</p></li>`).join('')}</ul>${taskPreview.skipped.length ? `<p>Skipped: ${taskPreview.skipped.map(note => escape(note.title)).join(', ')}</p>` : ''}<p class="form-note">Tasks are drafts, not assigned or issued. Instructions are copied into tasks and can be read by anyone receiving their QR card. Source links stay in this project and are not included in the existing QR task card. Feature references are not added to the card. Project notes do not get a fabricated location.</p>${taskPreview.tasks.length ? '<button type="button" data-task-commit>Create draft field tasks</button>' : ''}`;
      result.querySelector('[data-task-commit]')?.addEventListener('click', event => {
        event.currentTarget.disabled = true;
        try { const tasks = ui.projectManager.createTasksFromMapNotes(taskPreview); taskPreview = null; result.textContent = `${tasks.length} draft field task(s) created and linked. Save this project to keep them. Open Field tasks to review and share.`; host.querySelectorAll('[data-task-select]').forEach(input => { input.checked = false; }); const count = host.querySelector('[data-task-selection-count]'); if (count) count.textContent = '0 notes selected'; }
        catch (error) { result.textContent = `Tasks not created: ${error.message}`; taskPreview = null; }
      });
    } catch (error) { taskPreview = null; result.textContent = `Cannot preview tasks: ${error.message}`; }
  });
  const form = host.querySelector('[data-data-note-form]');
  const read = name => form.querySelector(`[name="${name}"]`).value;
  const showTarget = () => {
    const type = read('targetType');
    form.querySelector('[data-target-custom]').hidden = type !== 'custom';
    form.querySelector('[data-target-dataset]').hidden = !['dataset', 'feature'].includes(type);
    form.querySelector('[data-target-feature]').hidden = type !== 'feature';
    form.querySelector('[data-target-service]').hidden = type !== 'service';
    form.querySelector('[data-target-location]').hidden = type !== 'location';
  };
  form.querySelector('[name="targetType"]').addEventListener('change', showTarget); showTarget();
  const showCategory = () => { form.querySelector('[data-custom-category]').hidden = read('category') !== 'custom'; };
  form.querySelector('[name="category"]').addEventListener('change', showCategory); showCategory();
  ui.setDataMapNoteTarget = picked => {
    current = picked;
    for (const [name, value] of Object.entries({ targetType: picked.type, datasetId: picked.datasetId || '', featureId: picked.featureId || '', sourceUrl: picked.sourceUrl || '', longitude: picked.coordinates?.[0] ?? '', latitude: picked.coordinates?.[1] ?? '', targetLabel: picked.label || '' })) form.querySelector(`[name="${name}"]`).value = value;
    showTarget();
    const status = form.querySelector('[data-map-note-pick-status]');
    if (status) status.textContent = picked.type === 'feature' ? 'Feature selected on the map.' : picked.type === 'dataset' ? 'Layer selected; feature has no stable ID.' : 'Location selected on the map.';
  };
  ['targetType', 'datasetId', 'featureId', 'sourceUrl', 'longitude', 'latitude', 'targetLabel'].forEach(name => ['input', 'change'].forEach(event => form.querySelector(`[name="${name}"]`)?.addEventListener(event, () => { ui.dataMapNotePickRevision = (ui.dataMapNotePickRevision || 0) + 1; })));
  form.querySelector('[data-map-note-save]').addEventListener('click', event => {
    const button = event.currentTarget;
    try {
      button.disabled = true;
      const type = read('targetType');
      const location = () => { const lon = read('longitude'), lat = read('latitude'); if (!lon.trim() || !lat.trim()) throw new Error('Enter both longitude and latitude.'); return [Number(lon), Number(lat)]; };
      const noteTarget = { type, ...(type === 'custom' ? { label: read('targetLabel').trim() } : {}), ...(['dataset', 'feature'].includes(type) ? { datasetId: read('datasetId').trim() } : {}), ...(type === 'feature' ? { featureId: read('featureId').trim() } : {}), ...(type === 'service' ? { sourceUrl: read('sourceUrl').trim() } : {}), ...(type === 'location' ? { coordinates: location() } : {}), ...(['feature', 'dataset'].includes(type) && current.sourceUrl && read('datasetId').trim() === current.datasetId ? { sourceUrl: current.sourceUrl } : {}) };
      // Preserve additional valid target context when an edit does not retarget the note.
      const unchangedTarget = type === current.type && (type === 'location'
        ? JSON.stringify(noteTarget.coordinates) === JSON.stringify(current.coordinates)
        : type === 'service' ? noteTarget.sourceUrl === current.sourceUrl
        : type === 'custom' ? noteTarget.label === current.label
        : noteTarget.datasetId === current.datasetId && (type !== 'feature' || noteTarget.featureId === current.featureId));
      const tags = read('tags');
      const changes = { target: unchangedTarget ? current : noteTarget, category: read('category') === 'custom' ? read('customCategory').trim() : read('category'), title: read('title'), body: read('body'), tags: selected && tags === selected.tags.join(', ') ? selected.tags : tags.split(',').map(tag => tag.trim()).filter(Boolean), status: read('status') };
      if (selected) registry.update(selected.id, changes); else registry.create(changes);
      ui.dataMapNotePoint = null; ui.refreshDataMapNoteMarkers?.();
      ui.toast(`Map Note ${selected ? 'updated' : 'added'} in this project. Save the project to keep it.`);
      openDataMapNotesPanel(ui);
    } catch (error) { form.querySelector('[data-map-note-error]').textContent = `Not saved: ${error.message}`; button.disabled = false; }
  });
  host.querySelector('[data-map-note-cancel]')?.addEventListener('click', () => openDataMapNotesPanel(ui));
  host.querySelectorAll('[data-map-note-edit]').forEach(button => button.addEventListener('click', () => openDataMapNotesPanel(ui, { editId: button.dataset.mapNoteEdit })));
  host.querySelectorAll('[data-map-note-remove]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.confirm !== 'yes') { button.dataset.confirm = 'yes'; button.textContent = 'Confirm remove'; return; }
    try { registry.remove(button.dataset.mapNoteRemove); openDataMapNotesPanel(ui); ui.toast('Map Note removed. Save the project to keep this change.'); } catch (error) { ui.error(`Could not remove Map Note: ${error.message}`); }
  }));
}
