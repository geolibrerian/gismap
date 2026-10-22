// An optional, non-destructive orientation. It never opens panels or changes map state.
export const WALKTHROUGH_STEPS = [
  { title: 'The map', desktop: '#viewDiv', mobile: '#viewDiv', description: 'Pan and zoom to explore. Select a feature on the map to inspect its details in Map Insight.' },
  { title: 'Menus', desktop: '.studio-header .menu-bar', mobile: '#mobile-menu-toggle', description: 'Project, Data, Map, Modes and Tools bring together saving, data sources, map settings and additional tools.' },
  { title: 'Find a place', desktop: '.studio-header__search', mobile: '[data-mobile-panel="places-panel"]', description: 'Use Places to search for a location and move the map there.' },
  { title: 'Workspaces', desktop: '.workspace-rail', mobile: '.mobile-panel-nav', description: 'Switch between the map, briefing, tours and other workflows. Your map stays available as you work.' },
  { title: 'Layers and data', desktop: '#layers-panel', mobile: '[data-mobile-panel="layers-panel"]', description: 'Layers holds your data. Add services, Geo URLs, local files or examples, then manage visibility, styling and the attribute table.' },
  { title: 'Notes, tasks and drawing', desktop: '.workspace-tabs', mobile: '.mobile-map-tool-strip', description: 'Use Notes & Tasks for observations and field work, and Draw for map annotations. On smaller screens these tools are in the map toolbar and menu.' },
  { title: 'Map controls', desktop: '#map-navigation-toggle', mobile: '#map-navigation-toggle', description: 'Use the map controls to zoom, reset north, switch to 3D and access camera tools. The chevron expands or hides the controls.' },
  { title: 'Project and sharing', desktop: '.studio-header__project', mobile: '#mobile-menu-toggle', description: 'Open Project to manage project details and save or export your work. Share provides the available map-sharing options.' },
  { title: 'Make something', desktop: '.context-workspace', mobile: '.context-workspace', description: 'Start Exploring suggests briefings, tours, presentation skins and data-specific ideas. You can revisit this walkthrough from the Tools menu.' },
];

export function startWorkspaceWalkthrough({ mobile = () => false } = {}) {
  document.querySelector('.workspace-walkthrough')?.dispatchEvent(new Event('walkthrough:close'));
  const previousFocus = document.activeElement;
  const fallbackFocus = previousFocus?.closest?.('.menu')?.querySelector('.menu__trigger');
  let index = 0;
  const root = document.createElement('section');
  root.className = 'workspace-walkthrough';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', 'Workspace walkthrough');
  const highlight = document.createElement('div');
  highlight.className = 'workspace-walkthrough__highlight';
  highlight.setAttribute('aria-hidden', 'true');
  const card = document.createElement('div');
  card.className = 'workspace-walkthrough__card';
  card.innerHTML = '<button class="workspace-walkthrough__close" type="button" aria-label="Close walkthrough">×</button><div class="workspace-walkthrough__content" aria-live="polite"><span class="workspace-walkthrough__count"></span><h2></h2><p></p></div><div class="workspace-walkthrough__actions"><button type="button" data-walkthrough-back>Back</button><button type="button" data-walkthrough-next>Next</button></div>';
  root.append(highlight, card);
  document.body.append(root);
  const count = card.querySelector('.workspace-walkthrough__count');
  const title = card.querySelector('h2');
  const description = card.querySelector('p');
  const back = card.querySelector('[data-walkthrough-back]');
  const next = card.querySelector('[data-walkthrough-next]');
  const position = () => {
    const step = WALKTHROUGH_STEPS[index];
    const target = document.querySelector(mobile() ? step.mobile : step.desktop);
    const bounds = target?.getBoundingClientRect();
    const visible = bounds && bounds.width && bounds.height && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth && getComputedStyle(target).visibility !== 'hidden';
    highlight.hidden = !visible;
    if (visible) Object.assign(highlight.style, { left: `${Math.max(0, bounds.left - 4)}px`, top: `${Math.max(0, bounds.top - 4)}px`, width: `${Math.min(window.innerWidth, bounds.right + 4) - Math.max(0, bounds.left - 4)}px`, height: `${Math.min(window.innerHeight, bounds.bottom + 4) - Math.max(0, bounds.top - 4)}px` });
  };
  const render = () => {
    const step = WALKTHROUGH_STEPS[index];
    count.textContent = `Step ${index + 1} of ${WALKTHROUGH_STEPS.length}`;
    title.textContent = step.title;
    description.textContent = step.description;
    back.disabled = index === 0;
    next.textContent = index === WALKTHROUGH_STEPS.length - 1 ? 'Done' : 'Next';
    position();
  };
  const close = () => {
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    document.removeEventListener('keydown', onKey);
    root.remove();
    const focusTarget = previousFocus?.isConnected && previousFocus.getClientRects().length ? previousFocus : fallbackFocus;
    if (focusTarget?.isConnected && typeof focusTarget.focus === 'function') focusTarget.focus();
  };
  const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  root.addEventListener('walkthrough:close', close, { once: true });
  card.querySelector('.workspace-walkthrough__close').addEventListener('click', close);
  back.addEventListener('click', () => { if (index > 0) { index--; render(); } });
  next.addEventListener('click', () => { if (index === WALKTHROUGH_STEPS.length - 1) close(); else { index++; render(); } });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  document.addEventListener('keydown', onKey);
  render();
  next.focus();
}
