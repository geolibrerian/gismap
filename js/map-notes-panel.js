import { FieldSessionController } from './field-session-store.js?v=0.1.1';
// A deliberately small first UI for project-owned location notes. The shared
// dialog supplies docking and mobile behavior. All note text is escaped.
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const choices = ['observation', 'issue', 'memory', 'question', 'idea', 'plan', 'other'];
const states = ['open', 'in_progress', 'resolved', 'archived'];
const label = (s) => s.replaceAll('_', ' ');
const options = (values, selected) => values.map((v) => `<option value="${v}"${v === selected ? ' selected' : ''}>${escape(label(v))}</option>`).join('');

export function openMapNotesPanel(ui, { point = null, editId = null, locationSource = 'map-selected', accuracy = null } = {}) {
  const field = ui.fieldSessionController ||= new FieldSessionController(ui.projectManager, ui.events);
  if (field.session && field.session.projectId !== ui.projectManager.current.id && field.session.resumedIntoProjectId !== ui.projectManager.current.id) field.session = null;
  const registry = ui.projectManager.notes;
  const note = editId ? registry.get(editId) : null;
  if (editId && !note) throw new Error('That note is no longer in this project.');
  const anchor = note?.anchor?.geometry?.type === 'Point' ? note.anchor.geometry.coordinates : point;
  const list = registry.list();
  const items = list.map((item) => `<article class="map-note-card"><strong>${escape(item.title || 'Untitled note')}</strong><p>${escape(item.body)}</p><small>${escape(label(item.type))} · ${escape(label(item.status))}</small><div class="map-note-card__actions"><button type="button" data-note-focus="${escape(item.id)}">Go to location</button>${item.anchor.geometry.type === 'Point' ? `<button type="button" data-note-edit="${escape(item.id)}">Edit</button>` : ''}<button type="button" data-note-remove="${escape(item.id)}">Remove</button></div></article>`).join('');
  ui.openDialog({ eyebrow: 'Map tools', title: 'Map Notes', content: `<div class="map-notes-panel"><p class="form-note">Observations are saved on this device, not published or sent to AI. Browser storage can be cleared: download a JSON backup regularly. Offline launch requires the application to have been cached separately.</p><section><h3>Field session</h3><label class="field"><span>Session title</span><input data-session-title maxlength="240" value="${escape(field.session?.title || 'Field notes')}" /></label><p class="form-note" data-field-storage>Checking local storage…</p><button type="button" data-persist-storage>Request persistent storage</button><div data-session-resume></div></section><section><h3>${note ? 'Edit note' : 'New location note'}</h3>${anchor ? `<p class="form-note">Location: ${escape(Number(anchor[1]).toFixed(5))}, ${escape(Number(anchor[0]).toFixed(5))}${locationSource === 'gps' && accuracy != null && !note ? ` · GPS accuracy ±${escape(Math.round(accuracy))} m` : ''}</p><div data-note-form><label class="field"><span>Type</span><select name="type">${options(choices, note?.type || 'observation')}</select></label><label class="field"><span>Title (optional)</span><input name="title" maxlength="240" value="${escape(note?.title || '')}" /></label><label class="field"><span>Details</span><textarea name="body" maxlength="20000" rows="4">${escape(note?.body || '')}</textarea></label>${note ? `<label class="field"><span>Status</span><select name="status">${options(states, note.status)}</select></label>` : ''}<div class="map-note-card__actions"><button type="button" data-note-save class="button--primary">${note ? 'Save changes' : 'Save observation'}</button>${note ? '<button type="button" data-note-cancel>Cancel editing</button>' : ''}</div><p data-note-error role="alert"></p></div>` : '<p class="form-note">Use your location or click a location on the map, then open Map Notes.</p>'}<button type="button" data-note-gps>Use my GPS location</button><p data-gps-error role="status"></p></section><section><div class="map-notes-panel__head"><h3>Project notes (${list.length})</h3><div class="map-note-card__actions"><button type="button" data-note-export ${list.length ? '' : 'disabled'}>Download notes JSON</button><button type="button" data-note-import-button>Import notes JSON</button><input type="file" accept=".json,application/json" data-note-import hidden></div></div>${items || '<p class="form-note">No notes in this project yet.</p>'}</section></div>` });
  const host = ui.dialog.querySelector('#dialog-content');
  host.querySelector('[data-note-save]')?.addEventListener('click', async (event) => {
    event.preventDefault(); const saveButton = event.currentTarget; const form = host.querySelector('[data-note-form]');
    const read = (name) => form.querySelector(`[name="${name}"]`)?.value || ''; 
    try {
      saveButton.disabled = true;
      if (!field.session || (field.session.projectId !== ui.projectManager.current.id && field.session.resumedIntoProjectId !== ui.projectManager.current.id)) field.session = null;
      if (!field.session) { const { newFieldSession } = await import('./field-session-store.js?v=0.1.1'); field.session = newFieldSession(ui.projectManager.current); }
      field.session.title = host.querySelector('[data-session-title]').value.trim().slice(0, 240) || 'Field notes';
      if (note) await field.mutate('update', note.id, { type: read('type'), title: read('title'), body: read('body'), status: read('status') });
      else await field.mutate('create', { type: read('type'), title: read('title'), body: read('body'), coordinateSource: locationSource, ...(accuracy != null ? { accuracyMeters: accuracy } : {}), anchor: { type: 'point', geometry: { type: 'Point', coordinates: anchor }, crs: 'EPSG:4326' } });
      ui.toast('Observation saved locally. Export a backup regularly.');
      openMapNotesPanel(ui, { point, locationSource, accuracy });
    } catch (error) { form.querySelector('[data-note-error]').textContent = `Not saved: ${error.message}`; saveButton.disabled = false; }
  });
  host.querySelector('[data-note-cancel]')?.addEventListener('click', () => openMapNotesPanel(ui, { point }));
  host.querySelectorAll('[data-note-edit]').forEach((button) => button.addEventListener('click', () => openMapNotesPanel(ui, { point, editId: button.dataset.noteEdit })));
  host.querySelectorAll('[data-note-focus]').forEach((button) => button.addEventListener('click', async () => {
    const selected = registry.get(button.dataset.noteFocus); if (!selected) return;
    const geometry = selected.anchor.geometry;
    const coordinates = geometry.type === 'Point' ? geometry.coordinates : geometry.type === 'LineString' ? geometry.coordinates[0] : geometry.coordinates[0][0];
    ui.dialog.close();
    try { await ui.mapController.setView({ center: coordinates.slice(0, 2), zoom: 15 }); } catch (error) { ui.error(error.message); }
  }));
  host.querySelectorAll('[data-note-remove]').forEach((button) => button.addEventListener('click', async () => {
    // Two-step confirmation avoids accidental removal without a native dialog.
    if (button.dataset.confirm !== 'yes') { button.dataset.confirm = 'yes'; button.textContent = 'Confirm remove'; return; }
    button.disabled = true; try { await field.mutate('remove', button.dataset.noteRemove); ui.toast('Observation removed locally.'); openMapNotesPanel(ui, { point, locationSource, accuracy }); } catch (error) { button.disabled = false; ui.error(`Could not remove observation: ${error.message}`); }
  }));
  host.querySelector('[data-note-import-button]')?.addEventListener('click', () => host.querySelector('[data-note-import]')?.click());
  host.querySelector('[data-note-import]')?.addEventListener('change', async (event) => {
    const file = event.currentTarget.files?.[0]; if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error('Notes files must be 2 MB or smaller.');
      const bundle = JSON.parse(await file.text());
      if (!bundle || bundle.schemaVersion !== '1.0' || !Array.isArray(bundle.notes) || Object.keys(bundle).some((key) => !['schemaVersion', 'notes'].includes(key))) throw new Error('This is not a supported notes JSON bundle.');
      const count = await field.mutate('import', bundle.notes); ui.toast(`Imported ${count} note${count === 1 ? '' : 's'} into this project.`); openMapNotesPanel(ui, { point });
    } catch (error) { ui.error(`Could not import notes: ${error.message}`); event.currentTarget.value = ''; }
  });
  host.querySelector('[data-persist-storage]')?.addEventListener('click', async () => {
    const status = host.querySelector('[data-field-storage]');
    try { const granted = await navigator.storage?.persist?.(); status.textContent = granted ? 'Persistent storage granted. Export a backup regularly.' : 'Persistent storage was not granted; the browser may evict data. Export a backup regularly.'; } catch { status.textContent = 'Persistent storage could not be requested. Export a backup regularly.'; }
  });
  host.querySelector('[data-note-gps]')?.addEventListener('click', (event) => {
    if (!navigator.geolocation) { host.querySelector('[data-gps-error]').textContent = 'GPS is unavailable in this browser.'; return; }
    const gpsButton = event.currentTarget; gpsButton.disabled = true; host.querySelector('[data-gps-error]').textContent = 'Finding your location…';
    navigator.geolocation.getCurrentPosition((position) => {
      openMapNotesPanel(ui, { point: [position.coords.longitude, position.coords.latitude], locationSource: 'gps', accuracy: position.coords.accuracy });
    }, (error) => { gpsButton.disabled = false; host.querySelector('[data-gps-error]').textContent = `Could not get location: ${error.message}`; }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  });
  (async () => {
    const status = host.querySelector('[data-field-storage]');
    try {
      const sessions = await field.store.list();
      if (!status.isConnected) return;
      const persisted = await navigator.storage?.persisted?.().catch(() => false);
      const estimate = await navigator.storage?.estimate?.().catch(() => null);
      const low = estimate?.quota && estimate.usage / estimate.quota > 0.8;
      status.textContent = `Local storage ready. ${persisted ? 'Persistent storage granted.' : 'Storage may be evicted by the browser.'}${low ? ' Device storage is running low.' : ''} Export a backup regularly.`;
      const container = host.querySelector('[data-session-resume]');
      if (sessions.length && !registry.list().length && !field.session) {
        const select = document.createElement('select'); select.setAttribute('aria-label', 'Saved field session');
        for (const session of sessions) { const option = document.createElement('option'); option.value = session.id; option.textContent = `${session.title} (${session.notes.length} observations)`; select.append(option); }
        const resume = document.createElement('button'); resume.type = 'button'; resume.textContent = 'Resume saved field session';
        resume.addEventListener('click', async () => { try { await field.resume(sessions.find((item) => item.id === select.value)); openMapNotesPanel(ui, { point, locationSource, accuracy }); } catch (error) { ui.error(error.message); } });
        container.append(select, resume);
      }
    } catch (error) { if (status.isConnected) status.textContent = `Local storage unavailable: ${error.message} Observations cannot be saved.`; }
  })();
  host.querySelector('[data-note-export]')?.addEventListener('click', () => {
    const blob = new Blob([registry.exportJSON()], { type: 'application/json' }); const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'gismap-notes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
}
