// The workspace orientation is non-destructive; specialized guides may prepare a workspace.
export const WALKTHROUGH_STEPS = [
  { title: 'The map', desktop: '#viewDiv', mobile: '#viewDiv', description: 'Pan and zoom to explore. Select a feature on the map to inspect its details in Map Insight.' },
  { title: 'Menus', desktop: '.studio-header .menu-bar', mobile: '#mobile-menu-toggle', description: 'Project, Data, Map, Modes and Tools bring together saving, data sources, map settings and additional tools.' },
  { title: 'Find a place', desktop: '.studio-header__search', mobile: '[data-mobile-panel="places-panel"]', description: 'Use Places to search for a location and move the map there.' },
  { title: 'Workspaces', desktop: '.workspace-rail', mobile: '.mobile-panel-nav', description: 'Switch between the map, briefing, tours and other workflows. Your map stays available as you work.' },
  { title: 'Layers and data', desktop: '#layers-panel', mobile: '[data-mobile-panel="layers-panel"]', description: 'Layers holds your data. Add services, Geo URLs, local files or examples, then manage visibility, styling and the attribute table.' },
  { title: 'Notes, tasks and drawing', desktop: '.workspace-tabs', mobile: '.mobile-map-tool-strip', description: 'Use Notes & Tasks for observations and field work, and Draw for map annotations. On smaller screens these tools are in the map toolbar and menu.' },
  { title: 'Map controls', desktop: '#map-navigation-toggle', mobile: '#map-navigation-toggle', description: 'Use the map controls to zoom, reset north, switch to 3D and access camera tools. The chevron expands or hides the controls.' },
  { title: 'Project and sharing', desktop: '.studio-header__project', mobile: '#mobile-menu-toggle', description: 'Open Project to manage project details and save or export your work. Share provides the available map-sharing options.' },
  { title: 'Make something', desktop: '.workspace-rail__welcome, #welcome-panel', mobile: '#mobile-menu-toggle', description: 'Open Welcome from the workspace toolbar to start a briefing, tour or dashboard. You can revisit this walkthrough from the Tools menu.' },
];

// The briefing guide loads its example before the hands-on steps.
export const BRIEFING_WALKTHROUGH_STEPS = [
  { title: 'Create a briefing', desktop: '.presentation-empty', mobile: '.presentation-empty', description: 'A briefing combines an interactive map with a sequence of slides. This guide will add example layers and an editable briefing to your project.' },
  { title: 'Start with data', desktop: '[data-presentation-setup="data-popular"]', mobile: '[data-presentation-setup="data-popular"]', description: 'Find a dataset, connect a service, or add a file. Choose a feature layer with the places or events you want to explain.' },
  { title: 'Try a finished example', desktop: '[data-presentation-setup="example-briefing"]', mobile: '[data-presentation-setup="example-briefing"]', description: 'Next will load hurricane and earthquake services and an editable example briefing. Existing slides are replaced only with your confirmation.' },
  { title: 'Choose your features', desktop: '#briefing-data-dock:not([hidden]), body:not(.briefing-v2) .briefing-select', mobile: '.briefing-select', description: 'Use the Data panel to search, filter, group, or select features. Use all matching features, or include only those you need.' },
  { title: 'Build your slides', desktop: '.briefing-new-slides, .briefing-slides__add', mobile: '.briefing-slides__add', description: 'Create slides from the map or your selected features, or start with a blank title, map, numbers or actions slide. Choose a slide in the list to edit its content and map view.' },
  { title: 'Arrange and review', desktop: '.briefing-slide-list', mobile: '.briefing-slide-list', description: 'Reorder, duplicate or hide slides in the list. Review each slide’s text, map view and layer visibility before presenting.' },
  { title: 'Preview and share', desktop: '.briefing-data-dock__actions:not([hidden]), body:not(.briefing-v2) .briefing-slides__actions', mobile: '.briefing-slides__actions', description: 'Use Preview slides to play the briefing. Share offers a link, QR code and PDF export. Exit the preview to keep editing.' },
];

export function waitForWalkthroughTarget(selector, { signal, timeout = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let observer, timer;
    const cleanup = () => { observer?.disconnect(); clearTimeout(timer); signal?.removeEventListener('abort', abort); };
    const abort = () => { cleanup(); reject(new Error('Walkthrough closed.')); };
    const check = () => {
      const target = [...document.querySelectorAll(selector)].find(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden');
      if (target) { cleanup(); resolve(target); }
    };
    if (signal?.aborted) return abort();
    observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => { cleanup(); reject(new Error('The briefing controls did not become available. Select Next to try again.')); }, timeout);
    check();
  });
}

export function startWorkspaceWalkthrough({ mobile = () => false, steps = WALKTHROUGH_STEPS, label = 'Workspace walkthrough', beforeStep = null } = {}) {
  if (!steps.length) return;
  document.querySelector('.workspace-walkthrough')?.dispatchEvent(new Event('walkthrough:close'));
  const previousFocus = document.activeElement;
  const fallbackFocus = previousFocus?.closest?.('.menu')?.querySelector('.menu__trigger');
  let index = 0;
  let closed = false;
  let pending = false;
  const controller = new AbortController();
  const root = document.createElement('section');
  root.className = 'workspace-walkthrough';
  root.setAttribute('role', 'region');
  root.setAttribute('aria-label', label);
  const highlight = document.createElement('div');
  highlight.className = 'workspace-walkthrough__highlight';
  highlight.setAttribute('aria-hidden', 'true');
  const card = document.createElement('div');
  card.className = 'workspace-walkthrough__card';
  card.innerHTML = '<button class="workspace-walkthrough__close" type="button" aria-label="Close walkthrough">×</button><div class="workspace-walkthrough__content" aria-live="polite"><span class="workspace-walkthrough__count"></span><h2></h2><p></p><p class="workspace-walkthrough__status" role="status" hidden></p></div><div class="workspace-walkthrough__actions"><button type="button" data-walkthrough-back>Back</button><button type="button" data-walkthrough-next>Next</button></div>';
  root.append(highlight, card);
  document.body.append(root);
  const count = card.querySelector('.workspace-walkthrough__count');
  const title = card.querySelector('h2');
  const description = card.querySelector('p');
  const status = card.querySelector('.workspace-walkthrough__status');
  const back = card.querySelector('[data-walkthrough-back]');
  const next = card.querySelector('[data-walkthrough-next]');
  const position = () => {
    const step = steps[index];
    const target = [...document.querySelectorAll(mobile() ? step.mobile : step.desktop)].find(element => element.getClientRects().length);
    const bounds = target?.getBoundingClientRect();
    const visible = bounds && bounds.width && bounds.height && bounds.bottom > 0 && bounds.right > 0 && bounds.top < window.innerHeight && bounds.left < window.innerWidth && getComputedStyle(target).visibility !== 'hidden';
    highlight.hidden = !visible;
    card.classList.toggle('workspace-walkthrough__card--top', Boolean(visible && bounds.bottom > window.innerHeight * .6 && bounds.right > window.innerWidth * .5));
    if (visible) Object.assign(highlight.style, { left: `${Math.max(0, bounds.left - 4)}px`, top: `${Math.max(0, bounds.top - 4)}px`, width: `${Math.min(window.innerWidth, bounds.right + 4) - Math.max(0, bounds.left - 4)}px`, height: `${Math.min(window.innerHeight, bounds.bottom + 4) - Math.max(0, bounds.top - 4)}px` });
  };
  const render = () => {
    const step = steps[index];
    count.textContent = `Step ${index + 1} of ${steps.length}`;
    title.textContent = step.title;
    description.textContent = step.description;
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? 'Done' : 'Next';
    position();
  };
  const close = () => {
    if (closed) return;
    closed = true;
    controller.abort();
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    document.removeEventListener('keydown', onKey);
    root.remove();
    const focusTarget = previousFocus?.isConnected && previousFocus.getClientRects().length ? previousFocus : fallbackFocus;
    if (focusTarget?.isConnected && typeof focusTarget.focus === 'function') focusTarget.focus();
  };
  const onKey = (event) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
  const observer = new MutationObserver(() => { if (!closed) requestAnimationFrame(position); });
  observer.observe(document.body, { childList: true, subtree: true });
  controller.signal.addEventListener('abort', () => observer.disconnect(), { once: true });
  root.addEventListener('walkthrough:close', close, { once: true });
  card.querySelector('.workspace-walkthrough__close').addEventListener('click', close);
  const move = async (nextIndex) => {
    if (pending || closed) return;
    status.hidden = true;
    if (beforeStep) {
      pending = true;
      back.disabled = true;
      next.disabled = true;
      status.textContent = 'Preparing the briefing…';
      status.hidden = false;
      try {
        const ready = await beforeStep(nextIndex, { signal: controller.signal });
        if (closed) return;
        if (ready === false) throw new Error('The example was not opened. Select Next to try again.');
      } catch (error) {
        if (closed) return;
        status.textContent = error.message || 'The briefing could not be prepared. Select Next to try again.';
        pending = false;
        back.disabled = index === 0;
        next.disabled = false;
        return;
      }
      pending = false;
      next.disabled = false;
      status.hidden = true;
    }
    index = nextIndex;
    render();
    const step = steps[index];
    [...document.querySelectorAll(mobile() ? step.mobile : step.desktop)].find(element => element.getClientRects().length)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    requestAnimationFrame(position);
  };
  back.addEventListener('click', () => { if (index > 0) void move(index - 1); });
  next.addEventListener('click', () => { if (index === steps.length - 1) close(); else void move(index + 1); });
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
  document.addEventListener('keydown', onKey);
  render();
  next.focus();
}
