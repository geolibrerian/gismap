import { normalizeApplicationConfig } from "./application-config.js?v=0.15.40";

export class LayoutManager {
  constructor({ registry, state, hosts = {}, mapController = null, documentRef = globalThis.document } = {}) {
    this.registry = registry;
    this.state = state;
    this.hosts = hosts;
    this.mapController = mapController;
    this.document = documentRef;
    this.current = null;
    this.previewSnapshot = null;
    this.panelHosts = new Map();
    this.resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => this.#resizeMap()) : null;
    Object.values(hosts).forEach((host) => { if (host) this.resizeObserver?.observe(host); });
  }

  beginPreview() {
    if (!this.previewSnapshot && this.current) this.previewSnapshot = structuredClone(this.current);
  }

  cancelPreview(context = {}) {
    if (!this.previewSnapshot) return false;
    const config = this.previewSnapshot;
    this.previewSnapshot = null;
    this.apply(config, context);
    return true;
  }

  commitPreview() {
    this.previewSnapshot = null;
  }

  apply(value, context = {}) {
    const config = normalizeApplicationConfig(value);
    this.registry.unmountAll({ ...context, state: this.state });
    this.state?.releasePanel && this.current?.panels?.forEach((panel) => this.state.releasePanel(panel.instanceId));
    this.#clearHosts();
    const ordered = [...config.panels].sort((a, b) => a.placement.region.localeCompare(b.placement.region) || a.placement.order - b.placement.order);
    for (const panel of ordered) {
      if (config.mode === "present" && !panel.audienceVisible) continue;
      const region = panel.placement.region;
      const dock = this.hosts[region] || this.hosts.left;
      if (!dock) continue;
      const host = this.#createPanelHost(panel);
      dock.append(host);
      this.panelHosts.set(panel.instanceId, host);
      this.registry.mount(panel, host.querySelector("[data-panel-body]"), {
        ...context,
        state: this.state,
        dispatch: (...args) => this.state?.dispatch?.(...args),
      });
    }
    this.current = config;
    this.#syncRegions();
    this.#resizeMap();
    return structuredClone(config);
  }

  move(instanceId, region, order = 0, context = {}) {
    if (!this.current) return false;
    const panel = this.current.panels.find((item) => item.instanceId === instanceId);
    const definition = this.registry.get(panel?.type);
    if (!panel || !definition?.placements.includes(region)) return false;
    panel.placement = { ...panel.placement, region, order };
    this.apply(this.current, context);
    return true;
  }

  remove(instanceId, context = {}) {
    if (!this.current) return false;
    const length = this.current.panels.length;
    this.current.panels = this.current.panels.filter((item) => item.instanceId !== instanceId);
    if (length === this.current.panels.length) return false;
    this.state?.releasePanel?.(instanceId);
    this.apply(this.current, context);
    return true;
  }

  #createPanelHost(panel) {
    const section = this.document.createElement("section");
    section.className = "application-panel";
    section.dataset.panelInstance = panel.instanceId;
    section.dataset.panelType = panel.type;
    section.toggleAttribute("data-collapsed", panel.collapsed);
    section.innerHTML = `<header><strong></strong><div class="application-panel__actions"><button type="button" data-panel-collapse aria-label="Collapse panel">−</button><button type="button" data-panel-remove aria-label="Remove panel">×</button></div></header><div data-panel-body class="application-panel__body"></div>`;
    section.querySelector("strong").textContent = panel.title;
    section.querySelector("[data-panel-collapse]").addEventListener("click", () => {
      panel.collapsed = !panel.collapsed;
      section.toggleAttribute("data-collapsed", panel.collapsed);
      this.#resizeMap();
    });
    section.querySelector("[data-panel-remove]").addEventListener("click", () => this.remove(panel.instanceId));
    return section;
  }

  #clearHosts() {
    this.panelHosts.clear();
    Object.values(this.hosts).forEach((host) => host?.replaceChildren?.());
  }

  #syncRegions() {
    for (const [region, host] of Object.entries(this.hosts)) {
      host?.toggleAttribute?.("hidden", !host.children.length);
      this.document?.body?.classList?.toggle(`application-${region}-open`, Boolean(host?.children.length));
    }
  }

  #resizeMap() {
    requestAnimationFrame(() => this.mapController?.resize?.());
  }
}
