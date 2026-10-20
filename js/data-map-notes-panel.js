import { refreshMapNoteFilters } from './map-note-filters.js?v=0.4.1';
import { refreshMapNoteWorkflow } from './map-note-workflow-ui.js?v=0.1.0';
import { refreshNoteRelationships } from './note-relationships-ui.js?v=0.1.0';
// A data-review workspace; contents are text, not instructions to execute.
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const categories = ['other', 'classification', 'data-quality', 'editing-instruction', 'clarification', 'insight', 'validation', 'investigation'];
const statuses = ['open', 'in-review', 'resolved', 'archived'];
const label = value => value.replaceAll('-', ' ');
// Display precision does not imply measurement accuracy; storage is capped separately.
const coordinate = value => value == null ? '' : Number(value).toFixed(6);
export const generatedNoteTitle = body => {
  const clean = body.trim().replace(/\s+/g, ' ');
  const sentence = clean.match(/^.*?[.!?](?=\s|$)/)?.[0] || clean;
  return sentence.length > 120 ? `${sentence.slice(0, 119).trimEnd()}…` : sentence;
};
const options = (values, selected) => values.map(value => `<option value="${escape(value)}"${value === selected ? ' selected' : ''}>${escape(label(value))}</option>`).join('');

export function openDataMapNotesPanel(ui, { editId = null, target = null } = {}) {
  const registry = ui.projectManager.mapNotes;
  const storageKey = `gismap:map-note-draft:${ui.projectManager.current?.id || 'session'}`;
  const store = () => { try { return globalThis.sessionStorage; } catch { return null; } };
  let draft = null;
  if (!editId && !target) { try { draft = JSON.parse(store()?.getItem(storageKey) || 'null'); } catch { /* Unavailable storage leaves the form usable. */ } }
  if (draft?.editId && registry.get(draft.editId)) editId = draft.editId;
  const selected = editId ? registry.get(editId) : null;
  if (editId && !selected) throw new Error('That Map Note no longer exists.');
  let current = draft?.target || selected?.target || target || { type: 'project' };
  let history = Array.isArray(draft?.history) ? draft.history.slice(-20) : [];
  const notes = registry.list();
  const cards = notes.map(note => `<article class="map-note-card" data-map-note-id="${escape(note.id)}" data-map-note-searchable="${escape([note.title, note.body, note.category, note.target.type, note.target.datasetId, note.target.featureId, ...note.tags].filter(Boolean).join(' '))}"><label><input type="checkbox" data-task-select="${escape(note.id)}" aria-label="Select ${escape(note.title || 'Map Note')} for field tasks" /> <strong>${escape(note.title || 'Untitled Map Note')}</strong></label><p>${escape(note.body)}</p><small>${escape((note.categories || [note.category]).map(label).join(', '))} · ${escape(label(note.status))} · ${escape(note.target.type)}${note.target.type === 'project' ? '' : `: ${escape(note.target.label || note.target.featureId || note.target.datasetId || note.target.sourceUrl || note.target.coordinates?.map(coordinate).join(', ') || '')}`} </small>${note.tags.length ? `<p class="form-note">Tags: ${escape(note.tags.join(', '))}</p>` : ''}<p class="form-note" data-note-workflow="${escape(note.id)}"></p><div class="map-note-card__actions"><button type="button" data-map-note-edit="${escape(note.id)}">Edit</button><button type="button" data-map-note-remove="${escape(note.id)}">Remove</button></div><details data-data-note-links="${escape(note.id)}"></details></article>`).join('');
  const host = ui.openDataMapNotesWorkspace(`<div class="map-notes-panel"><p class="form-note">Click the map to choose a location or feature for this note. Map Notes do not modify a layer or authorize an AI action. Save the project to keep them. Address lookup sends the clicked location to the map’s geocoding provider.</p><div class="map-note-mode"><div><strong>Map interaction</strong><p class="form-note" data-note-mode-hint>Click the map to place or move this note.</p></div><button type="button" data-note-pause aria-pressed="${ui.dataMapNotePaused ? 'true' : 'false'}">${ui.dataMapNotePaused ? 'Resume placing' : 'Pause & inspect'}</button></div><section><h3>${selected ? 'Edit Map Note' : 'New Map Note'}</h3><div data-data-note-form><p class="form-note" data-note-draft-status>No unsaved session draft.</p><label class="field"><span>Target</span><select name="targetType">${options(['project', 'dataset', 'feature', 'service', 'location', 'custom'], current.type)}</select></label><label class="field"><span>Note <small>Enter a note or a title</small></span><textarea name="body" rows="4" placeholder="Add your observations, questions, or instructions…" maxlength="20000">${escape(selected?.body || '')}</textarea></label><label class="field"><span>Title (optional)</span><input name="title" placeholder="Generated from your note if left blank" maxlength="240" value="${escape(selected?.title || '')}" /></label><div class="map-note-metadata"><label class="field"><span>Category</span><select name="category">${options([...categories, 'custom'], categories.includes(selected?.category || 'other') ? (selected?.category || 'other') : 'custom')}</select></label><div data-custom-category><label class="field"><span>Custom category</span><input name="customCategory" maxlength="80" value="${escape(selected && !categories.includes(selected.category) ? selected.category : '')}" /></label></div><details class="map-note-extra-categories"><summary>Additional categories (optional)</summary><p class="form-note">Select any that apply, or enter your own categories below.</p><div class="map-note-category-grid">${categories.map(item => `<label><input type="checkbox" data-extra-category="${escape(item)}"${selected?.categories?.slice(1).includes(item) ? ' checked' : ''} /> ${escape(label(item))}</label>`).join('')}</div><label class="field"><span>Additional custom categories (comma-separated)</span><input name="extraCategories" value="${escape((selected?.categories || []).slice(1).filter(item => !categories.includes(item)).join(', '))}" /></label></details><label class="field"><span>Tags (comma-separated)</span><input name="tags" value="${escape(selected?.tags.join(', ') || '')}" /></label><label class="field"><span>Review status</span><select name="status">${options(statuses, selected?.status || 'open')}</select></label></div><div data-map-note-context class="map-note-context"></div><details class="map-note-target-details"><summary>Target details &amp; previous locations</summary><p class="form-note" data-map-note-pick-status>Click the map to set the target; text already entered will be kept.</p><div data-map-note-location-history></div><div data-target-custom><label class="field"><span>Custom target</span><input name="targetLabel" maxlength="256" value="${escape(current.label || '')}" placeholder="Describe the target" /></label></div><div data-target-dataset><label class="field"><span>Dataset ID</span><input name="datasetId" maxlength="256" value="${escape(current.datasetId || '')}" /></label></div><div data-target-feature><label class="field"><span>Feature ID</span><input name="featureId" maxlength="256" value="${escape(current.featureId || '')}" /></label></div><div data-target-service><label class="field"><span>Service URL</span><input name="sourceUrl" type="url" value="${escape(current.sourceUrl || '')}" placeholder="https://example.org/service" /></label><p class="form-note">Use a URL without credentials or access tokens.</p></div><div data-target-location><label class="field"><span>Longitude</span><input name="longitude" type="number" step="any" value="${escape(coordinate(current.coordinates?.[0]))}" /></label><label class="field"><span>Latitude</span><input name="latitude" type="number" step="any" value="${escape(coordinate(current.coordinates?.[1]))}" /></label></div></details><div class="map-note-card__actions"><button type="button" data-map-note-save class="button--primary">${selected ? 'Save changes' : 'Add Map Note'}</button>${selected ? '<button type="button" data-map-note-cancel>Cancel editing</button>' : ''}</div><p role="alert" data-map-note-error></p></div></section><section data-map-note-filter-panel><h3>Project Map Notes (${notes.length})</h3><label class="field"><span>Search notes</span><input type="search" data-map-note-filter="search" placeholder="Search title, text, dataset, feature, or tag" /></label><details><summary>Filter notes</summary><label class="field"><span>Distance from map center (miles)</span><input type="number" min="0.01" max="12500" step="any" data-map-note-filter="radius" placeholder="Any distance" /></label><button type="button" data-map-note-center>Use current map center</button><p class="form-note" data-map-note-center-status>Choose a map center to filter by distance. Notes without a location are excluded when a distance is set.</p><div class="map-note-filter-grid"><label class="field"><span>Scope</span><select data-map-note-filter="scope"><option value="">All scopes</option>${options(['project', 'dataset', 'feature', 'service', 'location', 'custom'])}</select></label><label class="field"><span>Category</span><select data-map-note-filter="category"><option value="">All categories</option>${options([...new Set([...categories, ...notes.flatMap(note => note.categories || [note.category])])])}</select></label><label class="field"><span>Note review status</span><select data-map-note-filter="review"><option value="">All review statuses</option>${options(statuses)}</select></label><label class="field"><span>Linked field tasks</span><select data-map-note-filter="task"><option value="">All task statuses</option><option value="none">No linked tasks</option><option value="outstanding">Outstanding</option><option value="awaiting-return">Reported complete, awaiting return</option><option value="completed">All reported complete</option><option value="returned">All reported returned</option><option value="unavailable">Unavailable or unknown</option></select></label></div><p class="form-note">Task filters use reported task statuses, not verified events. Completing a task does not resolve the Map Note.</p></details><p class="form-note" data-map-note-visible-count></p>${notes.length ? `<div class="map-note-card__actions"><button type="button" data-task-select-visible>Select visible</button><button type="button" data-task-clear-selection>Clear selection</button></div><p data-task-selection-count>0 notes selected</p><p class="form-note">Searching or filtering does not clear selected notes, including notes hidden from view.</p><label class="field"><span>Task grouping</span><select data-task-strategy><option value="one-per-note">One task per note</option><option value="combined">One combined task</option></select></label><label><input type="checkbox" data-task-skip checked /> Skip notes with outstanding or unavailable tasks</label><div class="map-note-card__actions"><button type="button" data-task-preview>Preview field tasks</button></div><div data-task-preview-result role="status"></div>` : ''}${cards || '<p class="form-note">No data-review notes in this project yet.</p>'}</section></div>`);
  refreshNoteRelationships(ui);
  refreshMapNoteWorkflow(ui);
  host.querySelectorAll('[data-map-note-filter]').forEach(control => { control.addEventListener('input', () => refreshMapNoteFilters(ui, host)); control.addEventListener('change', () => refreshMapNoteFilters(ui, host)); });
  const centerStatus = host.querySelector('[data-map-note-center-status]');
  const updateCenterStatus = () => { if (centerStatus && ui.mapNoteFilterCenter) centerStatus.textContent = `Distance measured from ${ui.mapNoteFilterCenter[1].toFixed(6)}, ${ui.mapNoteFilterCenter[0].toFixed(6)}. Notes without a location are excluded.`; };
  host.querySelector('[data-map-note-center]')?.addEventListener('click', () => {
    const center = ui.mapController?.getViewState()?.center;
    if (!Array.isArray(center) || center.length < 2 || !center.slice(0, 2).every(Number.isFinite)) { if (centerStatus) centerStatus.textContent = 'Map center is unavailable.'; return; }
    ui.mapNoteFilterCenter = [((center[0] + 180) % 360 + 360) % 360 - 180, center[1]]; updateCenterStatus(); refreshMapNoteFilters(ui, host);
  });
  updateCenterStatus(); refreshMapNoteFilters(ui, host);
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
  const fields = ['targetType', 'targetLabel', 'datasetId', 'featureId', 'sourceUrl', 'longitude', 'latitude', 'category', 'customCategory', 'extraCategories', 'title', 'body', 'tags', 'status'];
  if (draft?.fields) for (const name of fields) { const control = form.querySelector(`[name="${name}"]`); if (control && typeof draft.fields[name] === 'string') control.value = draft.fields[name]; }
  if (Array.isArray(draft?.extras)) host.querySelectorAll('[data-extra-category]').forEach(input => { input.checked = draft.extras.includes(input.dataset.extraCategory); });
  const captureDraft = () => {
    const values = Object.fromEntries(fields.map(name => [name, form.querySelector(`[name="${name}"]`)?.value || '']));
    const extras = [...host.querySelectorAll('[data-extra-category]')].filter(input => input.checked).map(input => input.dataset.extraCategory);
    const dirty = Boolean(editId || ['title', 'body', 'tags', 'customCategory', 'extraCategories', 'datasetId', 'featureId', 'sourceUrl', 'targetLabel', 'longitude', 'latitude'].some(name => values[name].trim()) || extras.length || current.coordinates || (values.category && values.category !== 'other') || (values.status && values.status !== 'open') || (values.targetType && values.targetType !== 'project'));
    const status = host.querySelector('[data-note-draft-status]');
    if (!dirty) { try { store()?.removeItem(storageKey); } catch {} ui.dataMapNoteDraftDirty = false; if (status) status.textContent = 'No unsaved session draft.'; return false; }
    ui.dataMapNoteDraftDirty = true;
    try { const storage = store(); if (!storage) throw new Error('Session storage unavailable'); storage.setItem(storageKey, JSON.stringify({ editId, target: current, history, fields: values, extras })); ui.dataMapNoteDraftStored = true; }
    catch { ui.dataMapNoteDraftStored = false; }
    if (status) status.textContent = ui.dataMapNoteDraftStored ? 'Unsaved draft kept in this tab session. Save the note and project to keep it.' : 'Unsaved draft: session storage is unavailable. Save the note before closing.';
    return true;
  };
  ui.captureDataMapNoteDraft = captureDraft;
  host.addEventListener?.('input', captureDraft); host.addEventListener?.('change', captureDraft);
  const pause = host.querySelector('[data-note-pause]');
  const updatePause = () => { if (!pause) return; pause.textContent = ui.dataMapNotePaused ? 'Resume placing' : 'Pause & inspect'; pause.setAttribute('aria-pressed', String(Boolean(ui.dataMapNotePaused))); const hint = host.querySelector('[data-note-mode-hint]'); if (hint) hint.textContent = ui.dataMapNotePaused ? 'Inspection is active. Map clicks will not change this draft.' : 'Click the map to place or move this note.'; ui.updateDataMapNoteCursor?.(); };
  pause?.addEventListener('click', () => { ui.dataMapNotePaused = !ui.dataMapNotePaused; ui.dataMapNotePickRevision = (ui.dataMapNotePickRevision || 0) + 1; updatePause(); }); updatePause();
  const renderHistory = () => { const panel = host.querySelector('[data-map-note-location-history]'); if (!panel || !('innerHTML' in panel)) return; panel.innerHTML = history.length ? `<details><summary>Previous locations (${history.length})</summary><p class="form-note">Restore an earlier location for this draft.</p>${history.map((item, index) => `<button type="button" data-note-history="${index}">${escape(item.coordinates?.map(coordinate).join(', ') || 'Previous target')}</button>`).join('')}</details>` : ''; panel.querySelectorAll('[data-note-history]').forEach(button => button.addEventListener('click', () => { const previous = history[Number(button.dataset.noteHistory)]; if (!previous) return; ui.dataMapNotePickRevision = (ui.dataMapNotePickRevision || 0) + 1; ui.setDataMapNoteTarget(previous); ui.dataMapNotePoint = previous.coordinates || null; ui.refreshDataMapNoteMarkers?.(); })); };
  const showTarget = () => {
    const type = read('targetType');
    form.querySelector('[data-target-custom]').hidden = type !== 'custom';
    form.querySelector('[data-target-dataset]').hidden = !['dataset', 'feature'].includes(type);
    form.querySelector('[data-target-feature]').hidden = type !== 'feature';
    form.querySelector('[data-target-service]').hidden = type !== 'service';
    form.querySelector('[data-target-location]').hidden = type !== 'location';
  };
  form.querySelector('[name="targetType"]').addEventListener('change', () => { showTarget(); const details = form.querySelector('.map-note-target-details'); if (details && read('targetType') !== 'project') details.open = true; }); showTarget();
  const showCategory = () => { form.querySelector('[data-custom-category]').hidden = read('category') !== 'custom'; };
  form.querySelector('[name="category"]').addEventListener('change', showCategory); showCategory();
  const renderContext = () => {
    const host = form.querySelector('[data-map-note-context]');
    if (!host || !("innerHTML" in host)) return;
    const context = current.context || {};
    const entries = [
      ...(context.address ? [{ kind: 'address', text: `Address: ${context.address}` }] : []),
      ...(context.geographies || []).map((item, index) => ({ kind: 'geographies', index, text: `${item.label}: ${item.value}` })),
      ...(context.features || []).map((item, index) => ({ kind: 'features', index, text: `${item.datasetTitle || item.datasetId}${item.featureId ? ` · feature ${item.featureId}` : ' · layer (no stable feature ID)'}` }))
    ];
    host.innerHTML = entries.length ? `<details class="map-note-context__details"><summary>${escape(context.address || "Related map context")} · ${entries.length} item(s)</summary><p class="form-note">Remove anything that does not belong to this note.</p>${entries.map((item, index) => `<label><input type="checkbox" data-context-item="${index}" checked /> ${escape(item.text)}</label>`).join('')}</details>` : '';
    const contextDetails = host.querySelector('.map-note-context__details');
    if (contextDetails && ui.dataMapNoteContextExpanded) contextDetails.open = true;
    contextDetails?.addEventListener('toggle', () => { ui.dataMapNoteContextExpanded = contextDetails.open; });
    host.querySelectorAll('[data-context-item]').forEach(input => input.addEventListener('change', () => {
      if (input.checked) return;
      const item = entries[Number(input.dataset.contextItem)];
      if (item.kind === 'address') delete context.address; else context[item.kind].splice(item.index, 1);
      renderContext(); captureDraft();
    }));
  };
  renderContext();
  ui.setDataMapNoteContext = parts => { current = { ...current, context: { ...(current.context || {}), ...parts } }; renderContext(); captureDraft(); };
  ui.setDataMapNoteTarget = picked => {
    if (current.coordinates && JSON.stringify(current.coordinates) !== JSON.stringify(picked.coordinates)) history = [...history.filter(item => JSON.stringify(item.coordinates) !== JSON.stringify(current.coordinates)), structuredClone(current)].slice(-20);
    current = picked;
    for (const [name, value] of Object.entries({ targetType: picked.type, datasetId: picked.datasetId || '', featureId: picked.featureId || '', sourceUrl: picked.sourceUrl || '', longitude: coordinate(picked.coordinates?.[0]), latitude: coordinate(picked.coordinates?.[1]), targetLabel: picked.label || '' })) form.querySelector(`[name="${name}"]`).value = value;
    showTarget(); renderContext(); renderHistory(); captureDraft();
    const status = form.querySelector('[data-map-note-pick-status]');
    if (status) status.textContent = picked.type === 'feature' ? 'Feature selected on the map.' : picked.type === 'dataset' ? 'Layer selected; feature has no stable ID.' : 'Location selected on the map.';
  };
  renderHistory();
  if (draft) captureDraft();
  if (draft?.target?.coordinates) { ui.dataMapNotePoint = draft.target.coordinates; ui.refreshDataMapNoteMarkers?.(); }
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
        ? Array.isArray(current.coordinates) && noteTarget.coordinates.every((value, index) => value === Number(coordinate(current.coordinates[index])))
        : type === 'service' ? noteTarget.sourceUrl === current.sourceUrl
        : type === 'custom' ? noteTarget.label === current.label
        : noteTarget.datasetId === current.datasetId && (type !== 'feature' || noteTarget.featureId === current.featureId));
      const tags = read('tags');
      const category = read('category') === 'custom' ? read('customCategory').trim() : read('category');
      const extras = [...host.querySelectorAll('[data-extra-category]')].filter(input => input.checked).map(input => input.dataset.extraCategory);
      const customExtras = (form.querySelector('[name="extraCategories"]')?.value || '').split(',').map(item => item.trim()).filter(Boolean);
      const allCategories = [...new Set([category, ...extras, ...customExtras])];
      const changes = { target: unchangedTarget ? current : noteTarget, category, ...(allCategories.length > 1 || selected?.schemaVersion === '5.0' ? { categories: allCategories } : {}), title: read('title').trim() || generatedNoteTitle(read('body')), body: read('body'), tags: selected && tags === selected.tags.join(', ') ? selected.tags : tags.split(',').map(tag => tag.trim()).filter(Boolean), status: read('status') };
      if (selected) registry.update(selected.id, changes); else registry.create(changes);
      try { store()?.removeItem(storageKey); } catch {} ui.dataMapNoteDraftDirty = false; ui.captureDataMapNoteDraft = null; ui.dataMapNotePoint = null; ui.refreshDataMapNoteMarkers?.();
      ui.toast(`Map Note ${selected ? 'updated' : 'added'} in this project. Save the project to keep it.`);
      openDataMapNotesPanel(ui);
    } catch (error) { form.querySelector('[data-map-note-error]').textContent = `Not saved: ${error.message}`; button.disabled = false; }
  });
  host.querySelector('[data-map-note-cancel]')?.addEventListener('click', () => { if (captureDraft() && !globalThis.confirm('Discard this unsaved edit?')) return; try { store()?.removeItem(storageKey); } catch {} ui.dataMapNoteDraftDirty = false; ui.captureDataMapNoteDraft = null; openDataMapNotesPanel(ui); });
  host.querySelectorAll('[data-map-note-edit]').forEach(button => button.addEventListener('click', () => { if (captureDraft() && !globalThis.confirm('Opening this note will replace the current session draft. Continue?')) return; try { store()?.removeItem(storageKey); } catch {} ui.dataMapNoteDraftDirty = false; ui.captureDataMapNoteDraft = null; openDataMapNotesPanel(ui, { editId: button.dataset.mapNoteEdit }); }));
  host.querySelectorAll('[data-map-note-remove]').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.confirm !== 'yes') { button.dataset.confirm = 'yes'; button.textContent = 'Confirm remove'; return; }
    try { registry.remove(button.dataset.mapNoteRemove); openDataMapNotesPanel(ui); ui.toast('Map Note removed. Save the project to keep this change.'); } catch (error) { ui.error(`Could not remove Map Note: ${error.message}`); }
  }));
}
