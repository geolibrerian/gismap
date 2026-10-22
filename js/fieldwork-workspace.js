import { basemapsForEngine, basemapEntry } from './basemap-catalog.js?v=0.53.0-gallery1';
import { createWorkspacePreferences } from './workspace-preferences.js?v=2';

// One icon family for the shell; all icon-only buttons also have accessible names.
const paths = {
  explore: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15m6-12v15"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5"/>',
  notes: '<path d="M5 3h14v18H5zM8 8h8M8 12h8M8 16h5"/>',
  draw: '<path d="m14 5 5 5M4 20l5-1L20 8a2 2 0 0 0-5-5L4 14Z"/>',
  briefs: '<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M12 17v4m-4 0h8M7 8h10M7 12h6"/>',
  tours: '<circle cx="6" cy="6" r="3"/><circle cx="18" cy="18" r="3"/><path d="M9 6h6a4 4 0 0 1 0 8H9a4 4 0 0 0-4 4h10"/>',
  ai: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/>',
  settings: '<path d="M4 7h16M4 17h16"/><circle cx="8" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  moon: '<path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z"/>',
  north: '<path d="m12 3 6 17-6-4-6 4Z"/>',
};
export const workspaceIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.explore}</svg>`;
const read = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch { /* Private browsing still works. */ } };
const workspacePanels = { layers: ['layers-panel'], explore: ['places-panel', 'bookmarks-panel', 'intelligence-panel'], notes: ['observations-panel'], draw: ['draw-panel'] };

/** Reuses live controls rather than cloning forms, listeners or map canvases. */
export function initializeFieldworkWorkspace({ ui, action, showSidebar, theme }) {
  const app = document.querySelector('#app');
  const sidebar = document.querySelector('#sidebar');
  const brand = sidebar.querySelector('.brand');
  const menu = sidebar.querySelector('.menu-bar');
  const search = document.querySelector('.place-search-combobox');
  const homes = [brand, menu, search].map(node => { const marker = document.createComment('fieldwork control home'); node.before(marker); return { node, marker }; });
  const header = document.createElement('header');
  header.className = 'studio-header';
  header.setAttribute('aria-label', 'GISMap workspace');
  header.innerHTML = '<div class="studio-header__search"></div><button type="button" class="studio-header__project" title="Project details and export"></button><button type="button" class="studio-theme" title="Switch to Observatory" aria-label="Switch to Observatory">' + workspaceIcon('moon') + '</button><button type="button" class="studio-share button--primary">Share</button>';
  const rail = document.createElement('nav');
  rail.className = 'workspace-rail';
  rail.setAttribute('aria-label', 'Workspaces');
  rail.innerHTML = [['explore','Explore'],['layers','Layers'],['notes','Notes & tasks'],['draw','Draw'],['briefs','Briefings'],['tours','Tours'],['ai','Ask GISMap']].map(([id,label]) => `<button type="button" data-workspace="${id}" aria-label="${label}" title="${label}" aria-pressed="false">${workspaceIcon(id)}<span>${label}</span></button>`).join('') + `<button type="button" class="workspace-rail__settings" aria-label="Display settings" title="Display settings">${workspaceIcon('settings')}<span>Settings</span></button>`;
  const tabs = document.createElement('nav');
  tabs.className = 'workspace-tabs';
  tabs.setAttribute('aria-label', 'Workspace panels');
  tabs.innerHTML = '<button type="button" data-workspace="layers">Layers</button><button type="button" data-workspace="notes">Notes & tasks</button><button type="button" data-workspace="explore">Explore</button><button type="button" class="workspace-collapse" aria-label="Collapse workspace" title="Collapse workspace">‹</button>';
  sidebar.prepend(tabs);
  const resizer = document.createElement('div');
  resizer.className = 'workspace-resizer';
  resizer.tabIndex = 0; resizer.setAttribute('role', 'separator'); resizer.setAttribute('aria-label', 'Resize workspace'); resizer.setAttribute('aria-orientation', 'vertical');
  sidebar.append(resizer);
  const layerActions = document.createElement('div');
  layerActions.className = 'workspace-layer-actions';
  layerActions.innerHTML = '<span>Your map layers</span><button type="button" class="button--primary">+ Add layer</button>';
  document.querySelector('#layers-panel > .panel__body').prepend(layerActions);
  layerActions.querySelector('button').addEventListener('click', () => {
    ui.openDialog({ eyebrow: 'Data', title: 'Add a layer', content: `<div class="studio-sources">
      <button type="button" data-studio-source="data-file"><strong>Local file</strong><span>GeoJSON, shapefile, KML & more</span></button>
      <button type="button" data-studio-source="data-arcgis"><strong>ArcGIS service</strong><span>Feature, map or imagery URL</span></button>
      <button type="button" data-studio-source="data-geojson"><strong>Geo URL</strong><span>GeoJSON or GeoParquet</span></button>
      <button type="button" data-studio-source="data-popular"><strong>Data catalog</strong><span>Browse public datasets</span></button>
    </div>` });
    ui.dialog.querySelectorAll('[data-studio-source]').forEach(button => button.addEventListener('click', () => {
      const source = button.dataset.studioSource;
      ui.dialog.close();
      action(source);
    }));
  });
  const basemaps = document.createElement('section');
  basemaps.className = 'workspace-basemaps';
  basemaps.innerHTML = '<label class="field"><span>Basemap</span><select aria-label="Basemap"></select></label>';
  document.querySelector('#layers-panel > .panel__body').append(basemaps);
  const basemapSelect = basemaps.querySelector('select');
  for (const item of basemapsForEngine(ui.mapController.getEngineId())) basemapSelect.add(new Option(item.label, item.id));
  basemapSelect.addEventListener('change', () => Promise.resolve(ui.mapController.setBasemap(basemapSelect.value)).catch(error => ui.error(error.message)));
  const syncBasemap = () => { const id = ui.mapController.getBasemapId(); const entry = basemapEntry(id); basemapSelect.value = [...basemapSelect.options].some(option => option.value === id) ? id : entry?.[ui.mapController.getEngineId()] || ''; };
  ['map:ready','map:basemap-changed'].forEach(event => ui.events.subscribe(event, syncBasemap));
  header.querySelector('.studio-share').addEventListener('click', () => action('share-export'));
  header.querySelector('.studio-header__project').addEventListener('click', () => action('project-details'));
  header.querySelector('.studio-theme').addEventListener('click', theme);
  rail.querySelector('.workspace-rail__settings').addEventListener('click', () => action('tools-display'));
  tabs.querySelector('.workspace-collapse').addEventListener('click', () => showSidebar(false));
  document.body.append(header, rail);
  let storage = null;
  try { storage = globalThis.localStorage; } catch { /* Session-only layout. */ }
  const preferences = createWorkspacePreferences(storage, read('gismap:workspace', 'layers'));
  let selected = preferences.snapshot().selected;
  const layoutControls = document.createElement('details');
  layoutControls.className = 'workspace-layout-controls';
  layoutControls.innerHTML = '<summary>Workspace layout</summary><p>Pin panels to keep them visible as you switch workspaces.</p><button type="button" data-layout-restore>Previous workspace</button><button type="button" data-layout-reset>Reset workspace</button>';
  sidebar.querySelector('.sidebar__footer').before(layoutControls);
  const pinButtons = new Map();
  sidebar.querySelectorAll('.sidebar__scroll > .panel').forEach(panel => {
    const summary = panel.querySelector(':scope > summary');
    if (!summary || !Object.values(workspacePanels).flat().includes(panel.id)) return;
    const pin = document.createElement('button');
    pin.type = 'button'; pin.className = 'workspace-pin';
    pin.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="workspace-pin__head" d="M16 3 21 8l-3 1-3 5v3l-2 2-8-8 2-2h3l5-3z"/><path d="m9 15-5 5"/></svg>';
    pin.addEventListener('click', event => {
      event.preventDefault(); event.stopPropagation();
      const pinned = preferences.snapshot().pinned.includes(panel.id);
      preferences.pin(panel.id, !pinned);
      if (!pinned) panel.open = true;
      syncPanels();
    });
    summary.append(pin); pinButtons.set(panel.id, pin);
  });
  layoutControls.querySelector('[data-layout-restore]').addEventListener('click', () => {
    if (preferences.restore()) { selected = preferences.snapshot().selected; showSidebar(true); syncPanels(); }
  });
  layoutControls.querySelector('[data-layout-reset]').addEventListener('click', () => {
    preferences.reset(); selected = preferences.snapshot().selected; showSidebar(true); syncPanels();
  });
  const select = id => {
    if (id === 'ai') { action('tools-assistant'); return; }
    if (id === 'briefs' || id === 'tours') {
      document.querySelector(`.desktop-workflows-menu [data-mobile-workflow="${id === 'briefs' ? 'briefing' : 'tours'}"]`)?.click();
      return;
    }
    if (!workspacePanels[id]) return;
    // Return from a narrative workspace through its existing router.
    if (app.dataset.presentation && app.dataset.presentation !== 'standard') document.querySelector('.desktop-workflows-menu [data-mobile-workflow="map"]')?.click();
    preferences.select(id); selected = preferences.snapshot().selected; save('gismap:workspace', selected);
    showSidebar(true);
    syncPanels();
    if (id === 'explore') document.querySelector('#place-query')?.focus();
  };
  [rail,tabs].forEach(nav => nav.querySelectorAll('[data-workspace]').forEach(button => button.addEventListener('click', () => select(button.dataset.workspace))));
  function syncPanels() {
    const active = document.body.classList.contains('fieldwork-desktop');
    if (active) document.body.dataset.navigationLayout = 'studio';
    const standard = !app.dataset.presentation || app.dataset.presentation === 'standard';
    const layout = preferences.snapshot();
    sidebar.dataset.workspace = selected;
    sidebar.querySelectorAll('.sidebar__scroll > .panel').forEach(panel => {
      const visible = workspacePanels[selected].includes(panel.id) || layout.pinned.includes(panel.id);
      panel.classList.toggle('workspace-hidden', active && standard && !visible);
      if (active && standard && visible) { panel.classList.remove('is-sidebar-optional-hidden'); panel.open = true; }
    });
    pinButtons.forEach((button, id) => {
      const pinned = layout.pinned.includes(id);
      const label = sidebar.querySelector(`#${id} > summary > span`)?.textContent || 'panel';
      button.setAttribute('aria-pressed', String(pinned));
      button.setAttribute('aria-label', `${pinned ? 'Unpin' : 'Pin'} ${label}`);
      button.title = `${pinned ? 'Unpin' : 'Pin'} ${label}`;
    });
    layoutControls.querySelector('[data-layout-restore]').disabled = !layout.previous;
    ui.events.publish('context:workspace-changed', { workspace: selected, pinnedPanels: layout.pinned });
    const currentWorkspace = standard ? selected : app.dataset.presentation === 'briefing' ? 'briefs' : app.dataset.presentation === 'atlas' ? 'tours' : '';
    [rail,tabs].forEach(nav => nav.querySelectorAll('[data-workspace]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.workspace === currentWorkspace))));
  }
  const sync = () => {
    const active = !ui.mobileMedia.matches && app.dataset.applicationLayout !== 'globe';
    document.body.classList.toggle('fieldwork-desktop', active);
    header.hidden = rail.hidden = tabs.hidden = resizer.hidden = !active;
    if (active) { header.prepend(brand, menu); header.querySelector('.studio-header__search').append(search); }
    else homes.forEach(({node,marker}) => marker.after(node));
    syncPanels();
    requestAnimationFrame(() => ui.mapController.resize());
  };
  ui.mobileMedia.addEventListener('change', sync);
  new MutationObserver(sync).observe(app, { attributes: true, attributeFilter: ['data-application-layout','data-presentation'] });
  const syncProject = () => { header.querySelector('.studio-header__project').textContent = document.querySelector('#project-name').textContent; };
  new MutationObserver(syncProject).observe(document.querySelector('#project-name'), { childList: true, subtree: true, characterData: true });
  const syncTheme = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    const button = header.querySelector('.studio-theme');
    button.title = button.ariaLabel = `Switch to ${dark ? 'Fieldwork' : 'Observatory'}`;
    button.setAttribute('aria-pressed', String(dark));
  };
  new MutationObserver(syncTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme','data-skin'] });
  const setWidth = value => {
    const width = Math.max(320, Math.min(480, window.innerWidth * .4, value));
    document.body.style.setProperty('--workspace-width', `${width}px`);
    resizer.setAttribute('aria-valuenow', String(Math.round(width)));
    resizer.setAttribute('aria-valuemin','320'); resizer.setAttribute('aria-valuemax',String(Math.min(480, Math.floor(window.innerWidth * .4))));
    save('gismap:workspace-width', String(width)); ui.mapController.resize();
  };
  setWidth(Number(read('gismap:workspace-width', '372')) || 372);
  resizer.addEventListener('pointerdown', event => { resizer.setPointerCapture(event.pointerId); });
  resizer.addEventListener('pointermove', event => { if (resizer.hasPointerCapture(event.pointerId)) setWidth(event.clientX); });
  resizer.addEventListener('pointerup', event => { if (resizer.hasPointerCapture(event.pointerId)) resizer.releasePointerCapture(event.pointerId); });
  resizer.addEventListener('keydown', event => { if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return; event.preventDefault(); const width = sidebar.getBoundingClientRect().width; setWidth(event.key === 'Home' ? 320 : event.key === 'End' ? 480 : width + (event.key === 'ArrowRight' ? 16 : -16)); });
  document.addEventListener('keydown', event => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k' && document.body.classList.contains('fieldwork-desktop')) { event.preventDefault(); document.querySelector('#place-query').focus(); }
    if (event.key === 'Escape') document.querySelectorAll('.map-camera-menu[open]').forEach(menu => { menu.open = false; menu.querySelector('summary').focus(); });
  });
  const dimension = document.querySelector('[data-camera-dimension]');
  const syncDimension = () => { const is3d = (ui.mapController.getViewState()?.tilt || 0) > 5; dimension.textContent = is3d ? '2D' : '3D'; dimension.title = dimension.ariaLabel = `Switch to ${is3d ? '2D' : '3D'} view`; dimension.setAttribute('aria-pressed', String(is3d)); };
  dimension.addEventListener('click', () => ui.mapController.setView({ tilt: (ui.mapController.getViewState()?.tilt || 0) > 5 ? 0 : 55 }, { animate: !matchMedia('(prefers-reduced-motion: reduce)').matches }).catch(error => ui.error(error.message)));
  ['view:stationary','map:ready'].forEach(event => ui.events.subscribe(event, syncDimension));
  syncProject(); syncTheme(); sync();
  return { select, syncPanels, layout: () => preferences.snapshot() };
}
