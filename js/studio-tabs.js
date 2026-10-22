/** Accessible tabs that keep form nodes alive, preserving unsaved input. */
export function initializeStudioTabs(root, { id = 'studio', initial } = {}) {
  const tabs = [...root.querySelectorAll('[data-studio-tab]')];
  const panes = [...root.querySelectorAll('[data-studio-pane]')];
  let selected = initial || tabs[0]?.dataset.studioTab;
  const select = (name, focus = false) => {
    const next = tabs.find(tab => tab.dataset.studioTab === name && !tab.disabled) || tabs.find(tab => !tab.disabled);
    if (!next) return;
    selected = next.dataset.studioTab;
    tabs.forEach(tab => { const active = tab === next; tab.setAttribute('aria-selected', String(active)); tab.tabIndex = active ? 0 : -1; });
    panes.forEach(pane => { pane.hidden = pane.dataset.studioPane !== selected; });
    if (focus) next.focus();
  };
  tabs.forEach(tab => {
    const name = tab.dataset.studioTab;
    tab.id = `${id}-tab-${name}`;
    tab.setAttribute('role','tab');
    tab.setAttribute('aria-controls', `${id}-pane-${name}`);
    tab.addEventListener('click', () => select(name));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft','ArrowRight','Home','End'].includes(event.key)) return;
      event.preventDefault();
      const enabled = tabs.filter(tab => !tab.disabled);
      const index = enabled.indexOf(tab);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? enabled.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + enabled.length) % enabled.length;
      select(enabled[next].dataset.studioTab, true);
    });
  });
  panes.forEach(pane => { pane.id = `${id}-pane-${pane.dataset.studioPane}`; pane.setAttribute('role','tabpanel'); pane.setAttribute('aria-labelledby', `${id}-tab-${pane.dataset.studioPane}`); pane.tabIndex = 0; });
  select(selected);
  return { select, refresh: () => select(selected) };
}
