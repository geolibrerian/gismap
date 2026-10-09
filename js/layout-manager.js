import { normalizeApplicationConfig } from "./application-config.js?v=0.16.0";

export class LayoutManager {
  constructor({ registry, state, hosts = {}, mapController = null, documentRef = globalThis.document, onConfigChange = null } = {}) {
    this.registry = registry;
    this.state = state;
    this.hosts = hosts;
    this.mapController = mapController;
    this.document = documentRef;
    this.onConfigChange = onConfigChange;
    this.current = null;
    this.previewSnapshot = null;
    this.panelHosts = new Map();
    this.boundWindowResize = () => this.#recoverFloatingPanels();
    globalThis.addEventListener?.("resize", this.boundWindowResize);
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
    const app = this.document?.querySelector?.("#app");
    if (app) app.dataset.applicationLayout = config.layout.kind;
    this.document?.body?.style?.setProperty("--application-bottom-height", `${config.layout.bottomHeight}px`);
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
    this.#configureBottomDock(config);
    this.#recoverFloatingPanels();
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
    this.#persistCurrent();
    return true;
  }

  remove(instanceId, context = {}) {
    if (!this.current) return false;
    const length = this.current.panels.length;
    this.current.panels = this.current.panels.filter((item) => item.instanceId !== instanceId);
    if (length === this.current.panels.length) return false;
    this.state?.releasePanel?.(instanceId);
    this.apply(this.current, context);
    this.#persistCurrent();
    return true;
  }

  #createPanelHost(panel) {
    const section = this.document.createElement("section");
    section.className = "application-panel";
    section.dataset.panelInstance = panel.instanceId;
    section.dataset.panelType = panel.type;
    section.toggleAttribute("data-collapsed", panel.collapsed);
    section.innerHTML = `<header><button type="button" class="application-panel__drag" data-panel-drag aria-label="Move panel">⠿</button><strong></strong><div class="application-panel__actions"><label><span class="sr-only">Dock panel</span><select data-panel-dock aria-label="Dock panel"><option value="left">Left</option><option value="right">Right</option><option value="bottom">Bottom</option><option value="floating">Float</option></select></label><button type="button" data-panel-collapse aria-label="Collapse panel">−</button><button type="button" data-panel-remove aria-label="Remove panel">×</button></div></header><div data-panel-body class="application-panel__body"></div>`;
    section.querySelector("strong").textContent = panel.title;
    section.querySelector("[data-panel-dock]").value = panel.placement.region;
    section.querySelector("[data-panel-dock]").addEventListener("change", (event) => this.move(panel.instanceId, event.target.value, panel.placement.order));
    section.querySelector("[data-panel-collapse]").addEventListener("click", () => {
      panel.collapsed = !panel.collapsed;
      section.toggleAttribute("data-collapsed", panel.collapsed);
      this.#resizeMap();
      this.#persistCurrent();
    });
    section.querySelector("[data-panel-remove]").addEventListener("click", () => this.remove(panel.instanceId));
    if (panel.placement.region === "floating") {
      section.style.width = `${panel.placement.size?.width || 360}px`;
      section.style.height = `${panel.placement.size?.height || 300}px`;
      section.style.left = `${panel.placement.position?.x || 24}px`;
      section.style.top = `${panel.placement.position?.y || 80}px`;
      this.#bindFloatingDrag(section, panel);
    }
    return section;
  }

  #configureBottomDock(config) {
    const dock = this.hosts.bottom;
    if (!dock?.children.length) return;
    dock.dataset.bottomMode = config.layout.kind === "bottom-nav" ? "nav" : "workspace";
    dock.classList.toggle("is-collapsed", config.layout.bottomCollapsed);
    const panels = [...dock.querySelectorAll(":scope > .application-panel")];
    const activeId = panels.some((panel) => panel.dataset.panelInstance === config.layout.activeBottomPanel)
      ? config.layout.activeBottomPanel : panels[0]?.dataset.panelInstance;
    config.layout.activeBottomPanel = activeId || null;
    const tabs = this.document.createElement("nav");
    tabs.className = "application-bottom-tabs";
    tabs.setAttribute("aria-label", config.layout.kind === "bottom-nav" ? "Bottom navigation" : "Bottom workspace tabs");
    panels.forEach((panel) => {
      const button = this.document.createElement("button");
      button.type = "button";
      button.textContent = panel.querySelector("header strong")?.textContent || "Panel";
      button.dataset.bottomPanel = panel.dataset.panelInstance;
      button.setAttribute("aria-selected", String(panel.dataset.panelInstance === activeId));
      panel.hidden = panel.dataset.panelInstance !== activeId;
      button.addEventListener("click", () => {
        config.layout.activeBottomPanel = panel.dataset.panelInstance;
        panels.forEach((item) => { item.hidden = item !== panel; });
        tabs.querySelectorAll("button").forEach((item) => item.setAttribute("aria-selected", String(item === button)));
        dock.classList.remove("is-collapsed");
        config.layout.bottomCollapsed = false;
        this.#resizeMap();
        this.#persistCurrent();
      });
      tabs.append(button);
    });
    const collapse = this.document.createElement("button");
    collapse.type = "button";
    collapse.className = "application-bottom-tabs__collapse";
    collapse.textContent = "⌄";
    collapse.setAttribute("aria-label", "Collapse bottom workspace");
    collapse.addEventListener("click", () => {
      config.layout.bottomCollapsed = dock.classList.toggle("is-collapsed");
      this.#resizeMap();
      this.#persistCurrent();
    });
    tabs.append(collapse);
    dock.prepend(tabs);
    if (config.layout.kind !== "bottom-nav") this.#bindBottomResize(dock, config);
  }

  #bindBottomResize(dock, config) {
    const handle = this.document.createElement("div");
    handle.className = "application-bottom-resizer";
    handle.tabIndex = 0;
    handle.setAttribute("role", "separator");
    handle.setAttribute("aria-orientation", "horizontal");
    handle.setAttribute("aria-label", "Resize bottom workspace");
    const resize = (height) => {
      config.layout.bottomHeight = Math.min(globalThis.innerHeight * .7, Math.max(180, height));
      this.document.body.style.setProperty("--application-bottom-height", `${config.layout.bottomHeight}px`);
      this.#resizeMap();
    };
    handle.addEventListener("pointerdown", (event) => {
      const startY = event.clientY;
      const start = config.layout.bottomHeight;
      const move = (moveEvent) => resize(start + startY - moveEvent.clientY);
      const up = () => { globalThis.removeEventListener("pointermove", move); globalThis.removeEventListener("pointerup", up); this.#persistCurrent(); };
      globalThis.addEventListener("pointermove", move);
      globalThis.addEventListener("pointerup", up);
    });
    handle.addEventListener("keydown", (event) => {
      if (!["ArrowUp", "ArrowDown"].includes(event.key)) return;
      event.preventDefault();
      resize(config.layout.bottomHeight + (event.key === "ArrowUp" ? 20 : -20));
      this.#persistCurrent();
    });
    dock.prepend(handle);
  }

  #bindFloatingDrag(section, panel) {
    const handle = section.querySelector("[data-panel-drag]");
    const rememberSize = () => {
      const rect = section.getBoundingClientRect();
      panel.placement.size = { width: Math.round(rect.width), height: Math.round(rect.height) };
      this.#recoverFloatingPanels();
      this.#persistCurrent();
    };
    section.addEventListener("pointerup", (event) => {
      if (event.target !== handle) rememberSize();
    });
    handle.addEventListener("pointerdown", (event) => {
      const rect = section.getBoundingClientRect();
      const start = { x: event.clientX, y: event.clientY, left: rect.left, top: rect.top };
      const move = (moveEvent) => {
        panel.placement.position = { x: start.left + moveEvent.clientX - start.x, y: start.top + moveEvent.clientY - start.y };
        section.style.left = `${panel.placement.position.x}px`;
        section.style.top = `${panel.placement.position.y}px`;
      };
      const up = () => {
        globalThis.removeEventListener("pointermove", move);
        globalThis.removeEventListener("pointerup", up);
        rememberSize();
      };
      globalThis.addEventListener("pointermove", move);
      globalThis.addEventListener("pointerup", up);
    });
  }

  #recoverFloatingPanels() {
    const dock = this.hosts.floating;
    if (!dock) return;
    dock.querySelectorAll(":scope > .application-panel").forEach((panel) => {
      const rect = panel.getBoundingClientRect();
      const left = Math.max(8, Math.min(globalThis.innerWidth - Math.min(rect.width, globalThis.innerWidth - 16) - 8, rect.left));
      const top = Math.max(8, Math.min(globalThis.innerHeight - Math.min(rect.height, globalThis.innerHeight - 16) - 8, rect.top));
      panel.style.left = `${left}px`;
      panel.style.top = `${top}px`;
      const configPanel = this.current?.panels?.find((item) => item.instanceId === panel.dataset.panelInstance);
      if (configPanel) configPanel.placement.position = { x: Math.round(left), y: Math.round(top) };
    });
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

  #persistCurrent() {
    if (this.current && typeof this.onConfigChange === "function") this.onConfigChange(structuredClone(this.current));
  }
}
