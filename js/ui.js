import { POPULAR_SERVICES } from "./catalog.js?v=0.16.0";
import { ENTERPRISE_CATALOGS, EnterpriseCatalog, normalizeArcGisDirectoryUrl } from "./enterprise-catalog.js?v=0.16.0";
import { createShareUrl } from "./share.js?v=0.16.0";
import { markdownToPlainText, renderMarkdown } from "./markdown.js?v=0.16.0";
import { formatAttributeValue } from "./attribute-format.js?v=0.16.0";
import { normalizeApplicationConfig, presetApplication } from "./application-config.js?v=0.16.0";
import { featureId, fieldKind, filterRecords, histogram, requestGuard, sortRecords } from "./presentation-query.js?v=0.16.0";

const DISPLAY_SETTINGS_KEY = "gismap-online:display:v1";
const INSIGHT_POSITIONS = new Set(["upper-left", "lower-left", "bottom", "dock-left", "dock-right", "dock-top", "dock-bottom"]);
const TABLE_POSITIONS = new Set(["overlay-bottom", "dock-left", "dock-right", "dock-top", "dock-bottom"]);
const BASEMAP_OPTIONS = [
  ["topo-3d", "3D Topographic"], ["navigation-3d", "3D Navigation"],
  ["navigation-dark-3d", "3D Navigation — dark"], ["osm-3d", "3D OpenStreetMap"],
  ["gray-3d", "3D Light gray"], ["dark-gray-3d", "3D Dark gray"],
  ["streets-3d", "3D Streets"], ["streets-dark-3d", "3D Streets — dark"],
  ["topo-vector", "2D Topographic"], ["streets-vector", "2D Streets"],
  ["navigation", "2D Navigation"], ["gray-vector", "2D Light gray"],
  ["dark-gray-vector", "2D Dark gray"], ["osm", "2D OpenStreetMap"],
  ["satellite", "Satellite"], ["hybrid", "Satellite + labels"],
];
const BASEMAP_IDS = new Set(BASEMAP_OPTIONS.map(([id]) => id));

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

export class UIController {
  constructor(events, mapController, projectManager, authController, aiController, toolManager, exportController, applicationRuntime) {
    Object.assign(this, { events, mapController, projectManager, authController, aiController, toolManager, exportController, applicationRuntime });
    this.dialog = document.querySelector("#app-dialog");
    this.searchResults = [];
    this.searchTimer = null;
    this.searchRequestId = 0;
    this.searchSelection = -1;
    this.lastInsight = null;
    this.selectedInsightIndexes = new Set();
    this.lastAIResponseText = null;
    this.lastAIQueryText = null;
    this.aiPending = false;
    this.identifyPending = false;
    this.utilityIntelligenceOpen = false;
    this.utilityDrawOpen = false;
    this.utilityStyleLayerUid = null;
    this.activeUtilityTab = null;
    this.utilityModalPane = null;
    this.utilityDialogOpen = false;
    this.suppressNextDialogClose = false;
    this.presentationSearchTimer = null;
    this.atlasPlaybackToken = 0;
    this.presentationState = { template: "standard", records: [], visibleRecords: [], selectedIds: new Set(), layerUid: null, search: "", searchField: "*", searchOperator: "contains", chartField: null, scope: "all", rangeMin: null, rangeMax: null, sortField: null, sortDirection: "asc", page: 1, pageSize: 25, binCount: 12 };
    this.briefingRequest = requestGuard();
    this.keepWelcomeForSharedExample = new URLSearchParams(location.search).has("example");
    this.systemThemeMedia = matchMedia("(prefers-color-scheme: dark)");
    this.mobileMedia = matchMedia("(max-width: 640px)");
  }

  initialize() {
    this.#applyDisplaySettings(this.#readDisplaySettings());
    this.systemThemeMedia.addEventListener?.("change", () => {
      const settings = this.#readDisplaySettings();
      if (settings.appearance === "system") this.#applyDisplaySettings(settings);
    });
    if (this.mobileMedia.matches) this.#setSidebarCollapsed(true);
    this.mobileMedia.addEventListener?.("change", ({ matches }) => {
      document.body.classList.remove("mobile-map-tools-open", "mobile-drawer-expanded");
      this.#setSidebarCollapsed(matches && this.presentationState.template === "standard");
      this.#applyDisplaySettings(this.#readDisplaySettings());
    });
    this.#buildMobileMenu();
    this.#bindMenus();
    this.#bindStaticActions();
    this.#bindInsightResize();
    this.#bindUtilityPanel();
    this.#bindMapEvents();
    this.#renderBookmarks();
    this.#renderLayers();
    document.querySelector("#insights-ai").hidden = !this.aiController.isConfigured();
    this.#renderIntelligenceContents();
  }

  #buildMobileMenu() {
    const drawer = document.querySelector("#mobile-menu-drawer");
    const desktopMenu = document.querySelector("#sidebar > .menu-bar");
    drawer.replaceChildren(desktopMenu.cloneNode(true));
  }

  #bindMenus() {
    document.querySelectorAll(".menu__trigger").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const menu = trigger.closest(".menu");
        const selectingConsolidated = document.body.dataset.navigationLayout === "top"
          && menu.closest(".menu-bar")?.classList.contains("is-consolidated-open");
        const open = selectingConsolidated || !menu.classList.contains("is-open");
        document.querySelectorAll(".menu.is-open").forEach((item) => item.classList.remove("is-open"));
        menu.classList.toggle("is-open", open);
        trigger.setAttribute("aria-expanded", String(open));
      });
    });
    document.querySelectorAll(".menu-bar__all-trigger").forEach((trigger) => {
      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const menuBar = trigger.closest(".menu-bar");
        const open = !menuBar.classList.contains("is-consolidated-open");
        document.querySelectorAll(".menu-bar.is-consolidated-open").forEach((item) => item.classList.remove("is-consolidated-open"));
        menuBar.classList.toggle("is-consolidated-open", open);
        trigger.setAttribute("aria-expanded", String(open));
        if (open && !menuBar.querySelector(".menu.is-open")) {
          const firstMenu = menuBar.querySelector(".menu");
          firstMenu?.classList.add("is-open");
          firstMenu?.querySelector(".menu__trigger")?.setAttribute("aria-expanded", "true");
        }
      });
    });
    document.addEventListener("click", () => {
      document.querySelectorAll(".menu.is-open").forEach((item) => item.classList.remove("is-open"));
      document.querySelectorAll(".menu__trigger").forEach((item) => item.setAttribute("aria-expanded", "false"));
      document.querySelectorAll(".menu-bar.is-consolidated-open").forEach((item) => item.classList.remove("is-consolidated-open"));
      document.querySelectorAll(".menu-bar__all-trigger").forEach((item) => item.setAttribute("aria-expanded", "false"));
    });
    document.querySelectorAll(".menu__content").forEach((menu) => menu.addEventListener("click", (e) => e.stopPropagation()));
  }

  #bindStaticActions() {
    document.querySelector("#welcome-close").addEventListener("click", () => this.#dismissWelcome());
    document.querySelectorAll("[data-action]").forEach((button) =>
      button.addEventListener("click", () => {
        if (button.closest("#welcome-panel")) this.#dismissWelcome();
        this.#closeMenus();
        this.#handleAction(button.dataset.action);
      }),
    );
    document.querySelectorAll("[data-basemap]").forEach((button) =>
      button.addEventListener("click", () => {
        this.mapController.setBasemap(button.dataset.basemap);
        this.toast(`Basemap changed to ${button.textContent.trim()}.`);
        this.#closeMenus();
      }),
    );
    document.querySelectorAll("[data-ground]").forEach((button) =>
      button.addEventListener("click", () => {
        this.mapController.setGround(button.dataset.ground);
        this.toast(`Terrain changed to ${button.textContent.trim()}.`);
        this.#closeMenus();
      }),
    );
    document.querySelectorAll("[data-basemap-picker]").forEach((select) =>
      select.addEventListener("change", () => {
        this.mapController.setBasemap(select.value);
        this.toast(`Basemap changed to ${select.selectedOptions[0]?.textContent.trim()}.`);
        this.#closeMenus();
      }),
    );
    document.querySelectorAll("[data-ground-picker]").forEach((select) =>
      select.addEventListener("change", () => {
        this.mapController.setGround(select.value);
        this.toast(`Terrain changed to ${select.selectedOptions[0]?.textContent.trim()}.`);
        this.#closeMenus();
      }),
    );
    document.querySelectorAll("[data-widget]").forEach((button) =>
      button.addEventListener("click", async () => {
        try {
          const active = await this.mapController.toggleWidget(button.dataset.widget);
          button.classList.toggle("is-active", active);
        } catch (error) {
          this.error(error.message);
        }
        this.#closeMenus();
      }),
    );
    document.querySelectorAll("[data-sidebar-panel-toggle]").forEach((button) =>
      button.addEventListener("click", () => {
        const panel = document.querySelector(`#${button.dataset.sidebarPanelToggle}`);
        if (!panel) return;
        this.#setOptionalPanelVisibility(panel.id, panel.classList.contains("is-sidebar-optional-hidden"));
        this.#closeMenus();
      }),
    );
    document.querySelectorAll("[data-draw]").forEach((button) =>
      button.addEventListener("click", () => this.mapController.draw(button.dataset.draw)),
    );
    document.querySelector("#draw-workspace-open").addEventListener("click", () => this.#openDrawUtility());
    document.querySelector("#draw-export").addEventListener("click", () => {
      const drawings = this.exportController.listExportableLayers().find((item) => item.kind === "drawings");
      if (!drawings) {
        this.error("Draw at least one point, line, polygon, or rectangle before exporting.");
        return;
      }
      this.#exportDialog(drawings.uid);
    });
    document.querySelectorAll("[data-nav]").forEach((button) =>
      button.addEventListener("click", () => this.mapController.navigate(button.dataset.nav).catch((e) => this.error(e.message))),
    );
    document.querySelector("#sidebar-close").addEventListener("click", () => this.#setSidebarCollapsed(true));
    document.querySelector("#sidebar-open").addEventListener("click", () => this.#setSidebarCollapsed(false));
    const toggleMobileMenu = (event) => {
      event.stopPropagation();
      const drawer = document.querySelector("#mobile-menu-drawer");
      const opening = drawer.hidden;
      drawer.hidden = !opening;
      document.querySelector("#mobile-menu-toggle").setAttribute("aria-expanded", String(opening));
      document.querySelector("#mobile-menu-toggle").classList.toggle("is-active", opening);
      document.body.classList.toggle("mobile-menu-open", opening);
      if (opening) {
        this.#dismissWelcome();
        document.querySelectorAll("[data-mobile-panel]").forEach((button) => {
          button.classList.remove("is-active");
          button.setAttribute("aria-pressed", "false");
        });
      }
      if (opening && matchMedia("(max-width: 640px)").matches) this.#setSidebarCollapsed(true);
      if (!opening) this.#closeMenus();
    };
    document.querySelector("#mobile-menu-toggle").addEventListener("click", toggleMobileMenu);
    document.querySelector("#mobile-map-tools-toggle").addEventListener("click", (event) => {
      const open = !document.body.classList.contains("mobile-map-tools-open");
      document.body.classList.toggle("mobile-map-tools-open", open);
      event.currentTarget.setAttribute("aria-expanded", String(open));
      event.currentTarget.setAttribute("aria-label", `${open ? "Close" : "Open"} map controls`);
    });
    document.querySelectorAll("[data-mobile-panel]").forEach((button) =>
      button.addEventListener("click", () => this.#activateMobilePanel(button.dataset.mobilePanel)),
    );
    document.querySelector("#utility-close").addEventListener("click", () => this.#closeActiveUtilityTab());
    this.#activateMobilePanel(null, false);
    document.querySelector("#insights-close").addEventListener("click", () => {
      this.mapController.clearFeatureHighlight();
      this.#setInsightsOpen(false);
    });
    document.querySelector("#insights-ai").addEventListener("click", () => {
      if (!this.lastInsight?.selectedResults?.length) {
        this.error("Select at least one Map Insight feature before asking for AI Insights.");
        return;
      }
      if (!this.aiController.isConfigured()) {
        this.error("Configure an AI provider from Tools before requesting AI Insights.");
        return;
      }
      this.#openIntelligenceUtility();
      this.#askAI(
        "Analyze the selected map features and their location. Explain the most important attributes, relationships, patterns, and useful geographic context.",
        this.lastInsight,
        "Selected data query",
      );
    });
    document.querySelectorAll(".sidebar__scroll > .panel > summary").forEach((summary) =>
      summary.addEventListener("click", () => {
        if (document.body.dataset.navigationLayout !== "top") return;
        document.querySelectorAll(".sidebar__scroll > .panel[open]").forEach((panel) => {
          if (panel !== summary.parentElement) panel.open = false;
        });
      }),
    );
    const placeInput = document.querySelector("#place-query");
    document.querySelector("#place-search").addEventListener("submit", (event) => this.#search(event));
    placeInput.addEventListener("input", () => this.#schedulePlaceSearch(placeInput.value));
    placeInput.addEventListener("keydown", (event) => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        this.#moveSearchSelection(event.key === "ArrowDown" ? 1 : -1);
      } else if (event.key === "Escape") {
        this.#clearSearchResults();
      }
    });
    document.addEventListener("click", (event) => {
      if (!event.target.closest(".place-search-combobox")) this.#clearSearchResults();
    });
    document.querySelector("#bookmark-add").addEventListener("click", () => this.#addBookmark());
    document.querySelector("#bookmark-manage")?.addEventListener("click", () => this.#bookmarkManagerDialog());
    this.dialog.addEventListener("close", () => {
      if (this.suppressNextDialogClose) {
        this.suppressNextDialogClose = false;
        return;
      }
      const wasDocked = this.utilityDialogOpen;
      this.exportController.cancel();
      this.#restoreUtilityModal();
      this.#undockDialogShell();
      if (wasDocked) this.#syncUtilityPanel();
    });
    document.querySelector("#dialog-dock").addEventListener("click", () => {
      this.#dockDialogInUtilityPanel();
    });
    document.querySelector("#utility-open-modal").addEventListener("click", () => this.#openUtilityAsModal());
    document.querySelector("#project-file-input").addEventListener("change", (event) => this.#importProject(event));
    document.querySelector("#data-file-input").addEventListener("change", (event) => this.#addFiles(event));
    document.querySelector("#tool-file-input").addEventListener("change", (event) => this.#loadTool(event));
    document.querySelector("#atlas-chapter-previous")?.addEventListener("click", () => this.#stepAtlasChapter(-1));
    document.querySelector("#atlas-chapter-next")?.addEventListener("click", () => this.#stepAtlasChapter(1));
    document.querySelector("#atlas-chapter-play")?.addEventListener("click", () => this.#toggleAtlasPlayback());
    document.querySelector("#application-edit-return")?.addEventListener("click", () => {
      const application = this.applicationRuntime.setMode("edit");
      this.projectManager.setApplication(application);
    });
  }

  #bindMapEvents() {
    const mapWorkspace = document.querySelector(".map-workspace");
    ["gesturestart", "gesturechange", "gestureend"].forEach((type) => {
      mapWorkspace.addEventListener(type, (event) => event.preventDefault(), { passive: false });
    });
    this.events.subscribe("map:ready", ({ view }) => {
      document.querySelector("#map-status").textContent = `Ready · zoom ${view.zoom.toFixed(1)}`;
      view.watch?.("scale", () => this.#updateLayerScaleIndicators());
      view.watch?.("stationary", (stationary) => {
        if (stationary && this.presentationState.template === "explorer" && this.presentationState.scope === "extent") {
          clearTimeout(this.presentationExtentTimer);
          this.presentationExtentTimer = setTimeout(() => this.#filterPresentationRecords(), 120);
        }
      });
      view.on("pointer-move", (event) => {
        const point = view.toMap(event);
        if (!point) return;
        document.querySelector("#map-status").textContent =
          `${point.longitude.toFixed(5)}, ${point.latitude.toFixed(5)} · zoom ${view.zoom.toFixed(1)}`;
      });
    });
    ["layer:added", "layer:removed", "layer:changed", "layers:reset"].forEach((topic) =>
      this.events.subscribe(topic, () => this.#renderLayers()),
    );
    this.events.subscribe("project:loaded", ({ project, missingFiles }) => {
      if (project.application?.configured) {
        this.#applyPresentation({ template: "standard" });
        this.applicationRuntime.apply(project.application);
      } else {
        this.applicationRuntime.deactivate();
        this.#applyPresentation(project.presentation);
      }
      this.#showProject(project);
      this.#renderBookmarks();
      this.#renderLayers();
      if (missingFiles?.length) {
        this.error(`Reattach local file${missingFiles.length === 1 ? "" : "s"}: ${missingFiles.join(", ")}`);
      }
    });
    this.events.subscribe("project:saved", ({ project, automatic }) => {
      this.#showProject(project, "Saved");
      if (!automatic) this.toast("Project saved in this browser.");
    });
    this.events.subscribe("presentation:changed", ({ presentation }) => {
      if (!this.projectManager.current.application) this.#applyPresentation(presentation);
    });
    this.events.subscribe("application:changed", ({ application }) => {
      if (!application?.configured) return this.applicationRuntime.deactivate();
      this.#applyPresentation({ template: "standard" });
      this.applicationRuntime.apply(application);
    });
    this.events.subscribe("identify:complete", (payload) => this.#selectPresentationResult(payload.results?.find((result) => result.layerUid === this.presentationState.layerUid)));
    this.events.subscribe("project:exported", ({ kind }) => this.toast(`${kind === "package" ? "Project package (.gmop)" : kind === "atlas" ? "Guided tour (.gmoatlas)" : "Project file (.gmo)"} downloaded.`));
    this.events.subscribe("export:progress", ({ stage, completed, total }) => {
      const progress = this.dialog.querySelector("[data-export-progress]");
      const status = this.dialog.querySelector("[data-export-status]");
      if (!progress || !status) return;
      if (total > 0) {
        progress.max = total;
        progress.value = Math.min(completed, total);
      } else {
        progress.removeAttribute("value");
      }
      status.textContent = stage === "packaging"
        ? `Packaging ${completed.toLocaleString()} features…`
        : `Retrieving ${completed.toLocaleString()}${total > 0 ? ` of ${total.toLocaleString()}` : ""} features…`;
    });
    this.events.subscribe("export:cancelled", () => this.toast("Data export cancelled."));
    this.events.subscribe("bookmarks:changed", () => this.#renderBookmarks());
    this.events.subscribe("identify:start", () => {
      this.mapController.clearFeatureHighlight();
      document.querySelector("#insights-overlay").setAttribute("aria-busy", "true");
      this.identifyPending = true;
      this.#renderIntelligenceContents();
    });
    this.events.subscribe("identify:complete", (payload) => {
      if (this.presentationState.template === "briefing") {
        this.#setInsightsOpen(false);
        return;
      }
      this.#renderInsight(payload);
    });
    this.events.subscribe("table:open", () => {
      this.mapController.clearFeatureHighlight();
      this.#setInsightsOpen(false);
    });
    this.events.subscribe("identify:error", ({ error }) => {
      document.querySelector("#insights-overlay").setAttribute("aria-busy", "false");
      this.error(`Identify failed: ${error.message}`);
    });
    this.events.subscribe("ai:start", () => {
      this.aiPending = true;
      this.lastAIResponseText = null;
      this.#renderIntelligenceContents();
      this.toast("Asking the configured model…");
    });
    this.events.subscribe("ai:complete", ({ text }) => {
      this.aiPending = false;
      this.#showAIResponse(text);
    });
    this.events.subscribe("ai:error", ({ error }) => {
      this.aiPending = false;
      this.#renderIntelligenceContents();
      this.error(error.message);
    });
    ["ai:configured", "ai:disabled"].forEach((topic) =>
      this.events.subscribe(topic, () => {
        document.querySelector("#insights-ai").hidden = !this.aiController.isConfigured();
        if (this.lastInsight) this.#renderInsight(this.lastInsight);
      }),
    );
    this.events.subscribe("tool:loaded", ({ tool }) => this.toast(`Custom tool loaded: ${tool.title || tool.id}`));
    this.events.subscribe("auth:status-changed", ({ connection, status }) => {
      if (connection && status?.signedIn) this.toast(`Connected to ${connection.name}${status.userId ? ` as ${status.userId}` : ""}.`);
    });
    this.events.subscribe("app:error", ({ message }) => this.error(message));
    this.events.subscribe("widget:toggled", ({ name, open }) => {
      document.querySelectorAll(`[data-widget="${name}"]`).forEach((button) => button.classList.toggle("is-active", open));
      if (!["basemapGallery", "elevationProfile", "legend"].includes(name)) return;
      this.#syncUtilityPanel(open ? name : null);
    });
  }

  #utilityWidgetTabs() {
    const labels = {
      basemapGallery: "Basemap gallery",
      elevationProfile: "Elevation profile",
      legend: "Legend",
    };
    return Object.entries(labels)
      .filter(([name]) => this.mapController.widgets.has(name))
      .map(([id, label]) => ({ id, label }));
  }

  #openUtilityAsModal() {
    if (this.activeUtilityTab === "dialog" && this.utilityDialogOpen) {
      this.#reopenDialog(false);
      return;
    }
    const pane = document.querySelector(`[data-utility-pane="${CSS.escape(this.activeUtilityTab || "")}"]`);
    if (!pane) return;
    this.utilityModalPane = pane;
    const title = document.querySelector("#utility-title").textContent || "Map tools";
    document.querySelector("#dialog-eyebrow").textContent = "Workspace panel";
    document.querySelector("#dialog-title").textContent = title;
    document.querySelector("#dialog-content").replaceChildren(pane);
    const footer = document.querySelector("#dialog-actions");
    footer.innerHTML = "";
    const restore = document.createElement("button");
    restore.type = "button";
    restore.textContent = "Return to panel";
    restore.className = "button--primary";
    restore.addEventListener("click", () => this.dialog.close());
    footer.append(restore);
    this.dialog.classList.remove("app-dialog--docked");
    if (!this.dialog.open) this.dialog.showModal();
  }

  #reopenDialog(docked) {
    if (!this.dialog.open) return;
    this.suppressNextDialogClose = true;
    this.dialog.close();
    if (docked) {
      // #app is the grid itself. Appending to a non-existent child previously
      // reserved the third column without moving the dialog into it.
      document.querySelector("#app")?.append(this.dialog);
      document.body.classList.add("dialog-panel-open");
      this.dialog.show();
    } else {
      this.#undockDialogShell();
      this.#syncUtilityPanel();
      this.dialog.showModal();
    }
    requestAnimationFrame(() => this.mapController.resize());
  }

  #dockDialogInUtilityPanel() {
    if (!this.dialog.open) return;
    this.suppressNextDialogClose = true;
    this.dialog.close();
    this.dialog.classList.add("app-dialog--docked");
    document.querySelector("#utility-dialog-content")?.append(this.dialog);
    // A non-modal dialog in a normal panel only needs the open attribute; it
    // must not enter the browser's top layer or retain a modal backdrop.
    this.dialog.setAttribute("open", "");
    this.utilityDialogOpen = true;
    this.#syncUtilityPanel("dialog");
  }

  #undockDialogShell() {
    if (this.dialog.parentElement !== document.body) document.body.append(this.dialog);
    this.dialog.classList.remove("app-dialog--docked");
    this.utilityDialogOpen = false;
    document.body.classList.remove("dialog-panel-open");
    requestAnimationFrame(() => this.mapController.resize());
  }

  #restoreUtilityModal() {
    if (!this.utilityModalPane) return;
    document.querySelector(".utility-panes")?.append(this.utilityModalPane);
    this.utilityModalPane = null;
    this.#syncUtilityPanel(this.activeUtilityTab);
  }

  #syncUtilityPanel(preferredTab = null) {
    const tabs = [
      ...this.#utilityWidgetTabs(),
      ...(this.utilityDialogOpen ? [{ id: "dialog", label: document.querySelector("#dialog-title")?.textContent || "Dialog" }] : []),
      ...(this.utilityDrawOpen ? [{ id: "draw", label: "Draw" }] : []),
      ...(this.utilityStyleLayerUid ? [{ id: "style", label: `Style: ${this.mapController.findLayer(this.utilityStyleLayerUid)?.title || "Layer"}` }] : []),
      ...(this.utilityIntelligenceOpen ? [{ id: "intelligence", label: "Intelligence" }] : []),
      ...(this.utilityPresentationOpen ? [{ id: "presentation", label: this.projectManager.current.presentation?.template === "briefing" ? "Context briefing" : this.projectManager.current.presentation?.template === "explorer" ? "Dataset explorer" : "Guided places" }] : []),
    ];
    const validTabs = new Set(tabs.map((tab) => tab.id));
    this.activeUtilityTab = validTabs.has(preferredTab)
      ? preferredTab
      : validTabs.has(this.activeUtilityTab) ? this.activeUtilityTab : tabs[0]?.id || null;
    const open = tabs.length > 0;
    if (open) this.#dismissWelcome();
    if (open && matchMedia("(max-width: 640px)").matches) this.#setSidebarCollapsed(true);
    const tabList = document.querySelector("#utility-tabs");
    tabList.hidden = tabs.length < 2;
    tabList.innerHTML = tabs.map((tab) => `<span class="utility-tab"><button type="button" data-utility-tab="${tab.id}" aria-selected="${tab.id === this.activeUtilityTab}">${escapeHtml(tab.label)}</button><button type="button" class="utility-tab__close" data-close-utility-tab="${tab.id}" aria-label="Close ${escapeHtml(tab.label)}" title="Close ${escapeHtml(tab.label)}">×</button></span>`).join("");
    tabList.querySelectorAll("[data-utility-tab]").forEach((button) => button.addEventListener("click", () => this.#syncUtilityPanel(button.dataset.utilityTab)));
    tabList.querySelectorAll("[data-close-utility-tab]").forEach((button) => button.addEventListener("click", () => this.#closeUtilityTab(button.dataset.closeUtilityTab)));
    document.querySelectorAll("[data-utility-pane]").forEach((pane) => { pane.hidden = pane.dataset.utilityPane !== this.activeUtilityTab; });
    document.querySelector("#utility-title").textContent = tabs.find((tab) => tab.id === this.activeUtilityTab)?.label || "Map tools";
    document.body.classList.toggle("utility-panel-open", open);
    document.querySelector("#utility-panel").setAttribute("aria-hidden", String(!open));
    requestAnimationFrame(() => this.mapController.resize());
  }

  #dismissWelcome() {
    const welcomePanel = document.querySelector("#welcome-panel");
    welcomePanel.dataset.dismissed = "true";
    welcomePanel.hidden = true;
  }

  #openIntelligenceUtility() {
    this.utilityIntelligenceOpen = true;
    const intelligencePanel = document.querySelector("#intelligence-panel");
    intelligencePanel.open = false;
    intelligencePanel.hidden = true;
    this.#renderIntelligenceContents();
    this.#syncUtilityPanel("intelligence");
  }

  #openDrawUtility() {
    this.utilityDrawOpen = true;
    const drawPanel = document.querySelector("#draw-panel");
    drawPanel.open = false;
    drawPanel.hidden = true;
    document.querySelector("#utility-draw-content").append(document.querySelector(".draw-tools"));
    this.#syncUtilityPanel("draw");
  }

  #closeActiveUtilityTab() {
    if (this.activeUtilityTab) this.#closeUtilityTab(this.activeUtilityTab);
  }

  #closeUtilityTab(tabId) {
    if (tabId === "dialog") {
      this.utilityDialogOpen = false;
      this.dialog.close();
      this.#syncUtilityPanel();
      return;
    }
    if (tabId === "intelligence") {
      this.utilityIntelligenceOpen = false;
      document.querySelector("#intelligence-panel").hidden = false;
      this.#syncUtilityPanel();
      return;
    }
    if (tabId === "presentation") {
      this.utilityPresentationOpen = false;
      const dashboard = document.querySelector("#presentation-dashboard");
      if (dashboard) document.querySelector(".sidebar__scroll")?.prepend(dashboard);
      document.body.classList.remove("presentation-workspace-panels-open");
      document.querySelectorAll(".sidebar__scroll > .panel[data-presentation-hidden]").forEach((panel) => { panel.hidden = true; });
      this.#syncUtilityPanel();
      return;
    }
    if (tabId === "draw") {
      this.utilityDrawOpen = false;
      const drawPanel = document.querySelector("#draw-panel");
      drawPanel.querySelector("summary").after(document.querySelector(".draw-tools"));
      drawPanel.hidden = false;
      this.#syncUtilityPanel();
      return;
    }
    if (tabId === "style") {
      this.utilityStyleLayerUid = null;
      document.querySelector("#utility-style-content").replaceChildren();
      this.#syncUtilityPanel();
      return;
    }
    if (["basemapGallery", "elevationProfile", "legend"].includes(tabId)) {
      void this.mapController.toggleWidget(tabId);
    }
  }

  #setSidebarCollapsed(collapsed) {
    const mobile = matchMedia("(max-width: 640px)").matches;
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    if (collapsed) document.body.classList.remove("mobile-drawer-expanded");
    document.querySelector("#sidebar").setAttribute("aria-hidden", String(mobile ? false : collapsed));
    const mobileDrawerContent = document.querySelector("#sidebar .sidebar__scroll");
    mobileDrawerContent.inert = mobile && collapsed;
    mobileDrawerContent.setAttribute("aria-hidden", String(mobile && collapsed));
    document.querySelector("#sidebar-open").setAttribute("aria-expanded", String(!collapsed));
    const handle = document.querySelector("#mobile-drawer-handle");
    handle?.setAttribute("aria-expanded", String(!collapsed));
    handle?.setAttribute("aria-label", `${collapsed ? "Expand" : "Collapse"} tool drawer`);
    requestAnimationFrame(() => this.mapController.resize());
  }

  #activateMobilePanel(panelId, openSidebar = true) {
    const current = document.querySelector("[data-mobile-panel].is-active")?.dataset.mobilePanel;
    const closing = openSidebar && current === panelId && !document.body.classList.contains("sidebar-collapsed");
    if (openSidebar) {
      this.#closeMenus();
      this.#dismissWelcome();
    }
    if (closing) panelId = null;
    document.querySelectorAll("[data-mobile-panel]").forEach((button) => {
      const active = button.dataset.mobilePanel === panelId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll(".sidebar__scroll > .panel").forEach((panel) => {
      const active = panel.id === panelId;
      panel.classList.toggle("is-mobile-active", active);
      if (active) panel.open = true;
    });
    document.body.classList.toggle("mobile-places-active", panelId === "places-panel");
    if (openSidebar) this.#setSidebarCollapsed(!panelId);
  }

  async #handleAction(action) {
    this.keepWelcomeForSharedExample = false;
    try {
      switch (action) {
        case "project-select":
          this.#selectProjectDialog();
          break;
        case "project-create":
          this.#createProjectDialog();
          break;
        case "project-save":
          this.#saveProjectDialog();
          break;
        case "project-export":
          this.projectManager.exportJson();
          break;
        case "project-package":
          await this.projectManager.exportPackage();
          break;
        case "atlas-export":
          this.projectManager.exportAtlas();
          break;
        case "project-import":
          document.querySelector("#project-file-input").click();
          break;
        case "project-share":
          await this.#copyShareLink();
          break;
        case "data-file":
          document.querySelector("#data-file-input").click();
          break;
        case "data-arcgis":
          this.#serviceDialog("arcgis-auto");
          break;
        case "data-geojson":
          this.#serviceDialog("geojson");
          break;
        case "data-wms":
          this.#serviceDialog("wms");
          break;
        case "data-wfs":
          this.#serviceDialog("wfs");
          break;
        case "data-export":
          this.#exportDialog();
          break;
        case "data-popular":
          this.#popularDataDialog();
          break;
        case "tools-custom":
          this.#customToolDialog();
          break;
        case "tools-connections":
          this.#connectionsDialog();
          break;
        case "tools-ai":
          this.#aiDialog();
          break;
        case "tools-display":
          this.#displaySettingsDialog();
          break;
        case "map-presentation":
          this.#presentationDialog();
          break;
        case "map-customize":
          this.#applicationBuilderDialog();
          break;
        case "tools-about":
          this.#aboutDialog();
          break;
      }
    } catch (error) {
      this.error(error.message);
    }
  }

  async #copyShareLink() {
    const href = createShareUrl({
      baseUrl: location.href,
      layers: this.mapController.getAllLayerConfigs(),
      basemap: this.mapController.getBasemapId(),
    });
    await navigator.clipboard.writeText(href);
    this.toast("Share link copied. Local files and credentials were not included.");
  }

  #selectProjectDialog() {
    const projects = this.projectManager.list();
    this.openDialog({
      eyebrow: "Local projects",
      title: "Select a project",
      content: projects.length
        ? `<div class="project-list">${projects.map((project) => `
            <button class="project-card" data-project-id="${escapeHtml(project.id)}">
              <strong>${escapeHtml(project.name)}</strong>
              <span>${escapeHtml(new Date(project.updatedAt).toLocaleString())} · ${project.layers?.length ?? 0} layers</span>
            </button>`).join("")}</div>`
        : '<div class="empty-state">No projects are saved in this browser yet.</div>',
    });
    this.dialog.querySelectorAll("[data-project-id]").forEach((button) =>
      button.addEventListener("click", async () => {
        this.dialog.close();
        await this.projectManager.loadSaved(button.dataset.projectId);
      }),
    );
  }

  #createProjectDialog() {
    this.openDialog({
      eyebrow: "New blank slate",
      title: "Create project",
      content: '<label class="field"><span>Project name</span><input id="new-project-name" value="Untitled project" /></label><p class="form-note">This clears operational layers and drawings from the current map.</p>',
      actions: [{ label: "Create project", primary: true, handler: async () => {
        const name = this.dialog.querySelector("#new-project-name").value;
        this.dialog.close();
        await this.projectManager.create(name);
      }}],
    });
  }

  #saveProjectDialog() {
    this.openDialog({
      eyebrow: "Browser storage",
      title: "Save project",
      content: `<label class="field"><span>Project name</span><input id="save-project-name" value="${escapeHtml(this.projectManager.current.name)}" /></label><p class="form-note">Service settings persist in localStorage. Browser security prevents saved projects from silently reopening local files; use a project package when those files must travel with the map.</p>`,
      actions: [{ label: "Save locally", primary: true, handler: () => {
        this.projectManager.save(this.dialog.querySelector("#save-project-name").value);
        this.dialog.close();
      }}],
    });
  }

  #exportDialog(preselectedUid = null) {
    const layers = this.exportController.listExportableLayers();
    if (!layers.length) throw new Error("Add a queryable vector layer before exporting data.");
    const selectedUid = layers.some((layer) => layer.uid === preselectedUid) ? preselectedUid : layers[0].uid;
    this.openDialog({
      eyebrow: "Download vector data",
      title: "Export data",
      content: `<label class="field"><span>Layer</span><select id="export-layer">${layers.map((layer) => `<option value="${escapeHtml(layer.uid)}" ${layer.uid === selectedUid ? "selected" : ""}>${escapeHtml(layer.title)}</option>`).join("")}</select></label>
        <label class="field"><span>Features</span><select id="export-scope"></select></label>
        <label class="field"><span>Format</span><select id="export-format"><option value="geojson">GeoJSON (.geojson)</option><option value="kml">KML (.kml)</option><option value="kmz">Compressed KML (.kmz)</option><option value="shapefile">Shapefile (.zip)</option></select></label>
        <label class="field"><span>File name</span><input id="export-file-name" value="${escapeHtml(layers.find((layer) => layer.uid === selectedUid)?.title || "layer")}" /></label>
        <p class="form-note">Geometry is exported as longitude and latitude in EPSG:4326. Shapefiles are delivered as ZIP archives and split into point, line, and polygon datasets when needed. Retrieval is paginated and conversion runs in a background worker.</p>`,
      actions: [{ label: "Export GeoJSON", primary: true, handler: () => this.#runExport() }],
    });
    const layerSelect = this.dialog.querySelector("#export-layer");
    const formatSelect = this.dialog.querySelector("#export-format");
    const scopeSelect = this.dialog.querySelector("#export-scope");
    const exportButton = this.dialog.querySelector(".button--primary");
    const updateScope = () => {
      const drawingSource = layers.find((item) => item.uid === layerSelect.value)?.kind === "drawings";
      scopeSelect.innerHTML = drawingSource
        ? '<option value="all">All drawings</option><option value="extent">Drawings in the current map extent</option>'
        : '<option value="filtered">All features matching the current layer filter</option><option value="extent">Filtered features in the current map extent</option><option value="source">Entire source layer (ignore the current filter)</option>';
    };
    const updateFormat = () => {
      const label = formatSelect.selectedOptions[0]?.textContent.replace(/\s*\([^)]*\)\s*$/, "") || "data";
      exportButton.textContent = `Export ${label}`;
    };
    layerSelect.addEventListener("change", () => {
      const layer = layers.find((item) => item.uid === layerSelect.value);
      this.dialog.querySelector("#export-file-name").value = layer?.title || "layer";
      updateScope();
    });
    formatSelect.addEventListener("change", updateFormat);
    updateScope();
    updateFormat();
  }

  async #runExport() {
    const options = {
      uid: this.dialog.querySelector("#export-layer").value,
      scope: this.dialog.querySelector("#export-scope").value,
      format: this.dialog.querySelector("#export-format").value,
      fileName: this.dialog.querySelector("#export-file-name").value,
    };
    document.querySelector("#dialog-title").textContent = "Preparing download";
    document.querySelector("#dialog-content").innerHTML = `<div class="export-progress"><progress data-export-progress></progress><strong data-export-status>Preparing feature query…</strong><small>You can continue using the map after starting the download. Cancel stops outstanding service requests and terminates the export worker.</small></div>`;
    const footer = document.querySelector("#dialog-actions");
    footer.innerHTML = "";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel export";
    cancel.addEventListener("click", () => {
      this.exportController.cancel();
      this.dialog.close();
    });
    footer.append(cancel);
    try {
      const result = await this.exportController.exportLayer(options);
      if (!result) return;
      this.dialog.close();
      const formatLabel = { geojson: "GeoJSON", kml: "KML", kmz: "KMZ", shapefile: "a zipped Shapefile" }[options.format];
      this.toast(`Exported ${result.featureCount.toLocaleString()} features as ${formatLabel}.`);
    } catch (error) {
      this.error(`Export failed: ${error.message}`);
      this.dialog.close();
    }
  }

  #readDisplaySettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY)) ?? {};
      return {
        insightPosition: INSIGHT_POSITIONS.has(saved.insightPosition) ? saved.insightPosition : "upper-left",
        defaultBasemap: BASEMAP_IDS.has(saved.defaultBasemap) ? saved.defaultBasemap : "topo-3d",
        insightDockWidth: Number.isFinite(saved.insightDockWidth) ? Math.min(720, Math.max(300, saved.insightDockWidth)) : 420,
        insightDockHeight: Number.isFinite(saved.insightDockHeight) ? Math.min(620, Math.max(220, saved.insightDockHeight)) : 360,
        tablePosition: TABLE_POSITIONS.has(saved.tablePosition) ? saved.tablePosition : "overlay-bottom",
        tableDockWidth: Number.isFinite(saved.tableDockWidth) ? Math.min(820, Math.max(360, saved.tableDockWidth)) : 520,
        tableDockHeight: Number.isFinite(saved.tableDockHeight) ? Math.min(680, Math.max(170, saved.tableDockHeight)) : 420,
        highlightEnabled: saved.highlightEnabled !== false,
        clickMarkerEnabled: saved.clickMarkerEnabled !== false,
        highlightColor: /^#[0-9a-f]{6}$/i.test(saved.highlightColor) ? saved.highlightColor : "#00b8d9",
        navigationLayout: saved.navigationLayout === "top" ? "top" : "side",
        utilityPanelWidth: Number.isFinite(saved.utilityPanelWidth) ? Math.min(620, Math.max(280, saved.utilityPanelWidth)) : 360,
        appearance: ["system", "light", "dark"].includes(saved.appearance) ? saved.appearance : "system",
        darkBasemapEnabled: saved.darkBasemapEnabled === true,
        bookmarksPanelVisible: saved.bookmarksPanelVisible === true,
        drawPanelVisible: saved.drawPanelVisible === true,
      };
    } catch {
      return { insightPosition: "upper-left", defaultBasemap: "topo-3d", insightDockWidth: 420, insightDockHeight: 360, tablePosition: "overlay-bottom", tableDockWidth: 520, tableDockHeight: 420, highlightEnabled: true, clickMarkerEnabled: true, highlightColor: "#00b8d9", navigationLayout: "side", utilityPanelWidth: 360, appearance: "system", darkBasemapEnabled: false, bookmarksPanelVisible: false, drawPanelVisible: false };
    }
  }

  #applyDisplaySettings(settings) {
    const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme = settings.appearance === "system" ? (prefersDark ? "dark" : "light") : settings.appearance;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.body.classList.toggle("calcite-mode-dark", resolvedTheme === "dark");
    const mobile = this.mobileMedia.matches;
    const insightPosition = mobile ? "dock-top" : settings.insightPosition;
    const tablePosition = mobile ? "dock-top" : settings.tablePosition;
    document.body.dataset.insightsPosition = insightPosition;
    document.body.style.setProperty("--insights-dock-width", `${settings.insightDockWidth ?? 420}px`);
    document.body.style.setProperty("--insights-dock-height", `${settings.insightDockHeight ?? 360}px`);
    document.body.dataset.tablePosition = tablePosition;
    document.body.dataset.navigationLayout = settings.navigationLayout ?? "side";
    this.#setOptionalPanelVisibility("bookmarks-panel", settings.bookmarksPanelVisible, false);
    this.#setOptionalPanelVisibility("draw-panel", settings.drawPanelVisible, false);
    if (settings.navigationLayout === "top") {
      document.querySelectorAll(".sidebar__scroll > .panel").forEach((panel) => { panel.open = false; });
    }
    document.body.style.setProperty("--table-dock-width", `${settings.tableDockWidth ?? 520}px`);
    document.body.style.setProperty("--table-dock-height", `${settings.tableDockHeight ?? 420}px`);
    document.body.style.setProperty("--utility-panel-width", `${settings.utilityPanelWidth ?? 360}px`);
    const resizer = document.querySelector("#insights-resizer");
    if (resizer) resizer.setAttribute("aria-orientation", ["dock-top", "dock-bottom"].includes(insightPosition) ? "horizontal" : "vertical");
    const tableResizer = document.querySelector("#table-resizer");
    if (tableResizer) tableResizer.setAttribute("aria-orientation", ["dock-top", "dock-bottom"].includes(tablePosition) ? "horizontal" : "vertical");
    this.mapController.setDefaultBasemap(settings.defaultBasemap);
    if (settings.darkBasemapEnabled) {
      this.mapController.setBasemap(resolvedTheme === "dark" ? "navigation-dark-3d" : settings.defaultBasemap);
    }
    this.mapController.configureInteractionFeedback(settings);
    requestAnimationFrame(() => this.mapController.resize());
  }

  #setOptionalPanelVisibility(panelId, visible, save = true) {
    const panel = document.querySelector(`#${panelId}`);
    if (!panel) return;
    panel.classList.toggle("is-sidebar-optional-hidden", !visible);
    if (visible && !this.mobileMedia.matches) panel.open = true;
    document.querySelectorAll(`[data-sidebar-panel-toggle="${panelId}"]`).forEach((button) => {
      const label = panelId === "bookmarks-panel" ? "Bookmarks" : "Draw";
      button.textContent = `${visible ? "Hide" : "Add"} ${label} panel`;
      button.setAttribute("aria-pressed", String(visible));
    });
    if (!save) return;
    const setting = panelId === "bookmarks-panel" ? "bookmarksPanelVisible" : "drawPanelVisible";
    const settings = { ...this.#readDisplaySettings(), [setting]: visible };
    localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
    this.toast(`${visible ? "Added" : "Removed"} ${panelId === "bookmarks-panel" ? "Bookmarks" : "Draw"} panel.`);
  }

  #displaySettingsDialog() {
    const current = this.#readDisplaySettings();
    const { insightPosition, tablePosition } = current;
    const defaultBasemap = this.mapController.getDefaultBasemapId();
    const basemapOptions = BASEMAP_OPTIONS.map(([id, label]) => `<option value="${id}" ${defaultBasemap === id ? "selected" : ""}>${label}</option>`).join("");
    this.openDialog({
      eyebrow: "Interface preferences",
      title: "Display settings",
      content: `<div class="display-settings-grid">
        <label class="field"><span>Appearance</span><select id="appearance"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label>
        <label class="field"><span>Application navigation</span><select id="navigation-layout"><option value="side">Side panel</option><option value="top">Top navigation bar</option></select></label>
        <label class="field"><span>Map Insight position</span><select id="insight-position"><optgroup label="Floating"><option value="upper-left">Upper left</option><option value="lower-left">Lower left</option><option value="bottom">Bottom overlay</option></optgroup><optgroup label="Dashboard"><option value="dock-left">Dock left</option><option value="dock-right">Dock right</option><option value="dock-top">Dock top</option><option value="dock-bottom">Dock bottom</option></optgroup></select></label>
        <label class="field"><span>Attribute table position</span><select id="table-position"><option value="overlay-bottom">Bottom overlay</option><option value="dock-left">Dock left</option><option value="dock-right">Dock right</option><option value="dock-top">Dock top</option><option value="dock-bottom">Dock bottom</option></select></label>
        <label class="field display-basemap"><span>Default basemap</span><select id="default-basemap">${basemapOptions}</select></label>
      </div>
      <label class="display-checkbox"><input id="dark-basemap-enabled" type="checkbox" ${current.darkBasemapEnabled ? "checked" : ""} /><span>Use a dark basemap when dark mode is enabled</span></label>
      <fieldset class="feedback-settings"><legend>Map click feedback</legend><label class="display-checkbox"><input id="click-marker-enabled" type="checkbox" ${current.clickMarkerEnabled ? "checked" : ""} /><span>Show a crosshair where the map is clicked</span></label><label class="display-checkbox"><input id="highlight-enabled" type="checkbox" ${current.highlightEnabled ? "checked" : ""} /><span>Highlight the feature selected in Map Insight</span></label><label class="highlight-color"><span>Feedback color</span><input id="highlight-color" type="color" value="${current.highlightColor}" /><output>${current.highlightColor.toUpperCase()}</output></label></fieldset>
      <label class="display-checkbox"><input id="apply-default-basemap" type="checkbox" /><span>Apply the default basemap to the current map</span></label><p class="form-note">Docked panels resize the map instead of covering it. Sizes, navigation, appearance, and feedback preferences are saved in this browser.</p>`,
      actions: [{ label: "Save settings", primary: true, handler: () => {
        const insightPosition = this.dialog.querySelector("#insight-position").value;
        const tablePosition = this.dialog.querySelector("#table-position").value;
        const navigationLayout = this.dialog.querySelector("#navigation-layout").value;
        const appearance = this.dialog.querySelector("#appearance").value;
        const defaultBasemap = this.dialog.querySelector("#default-basemap").value;
        const settings = { ...this.#readDisplaySettings(), insightPosition, tablePosition, navigationLayout, appearance, defaultBasemap, darkBasemapEnabled: this.dialog.querySelector("#dark-basemap-enabled").checked, highlightEnabled: this.dialog.querySelector("#highlight-enabled").checked, clickMarkerEnabled: this.dialog.querySelector("#click-marker-enabled").checked, highlightColor: this.dialog.querySelector("#highlight-color").value };
        localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
        this.#applyDisplaySettings(settings);
        if (this.dialog.querySelector("#apply-default-basemap").checked) {
          this.mapController.setBasemap(defaultBasemap);
        }
        this.dialog.close();
        this.toast("Display settings saved.");
      }}],
    });
    this.dialog.querySelector("#insight-position").value = insightPosition;
    this.dialog.querySelector("#table-position").value = tablePosition;
    this.dialog.querySelector("#navigation-layout").value = current.navigationLayout;
    this.dialog.querySelector("#appearance").value = current.appearance;
    this.dialog.querySelector("#highlight-color").addEventListener("input", (event) => {
      event.currentTarget.nextElementSibling.value = event.currentTarget.value.toUpperCase();
    });
  }

  #setInsightsOpen(open) {
    const overlay = document.querySelector("#insights-overlay");
    const wasOpen = !overlay.hidden;
    overlay.hidden = !open;
    document.body.classList.toggle("insights-open", open);
    if (wasOpen !== open) requestAnimationFrame(() => this.mapController.resize());
  }

  #bindInsightResize() {
    const handle = document.querySelector("#insights-resizer");
    const resizeBy = (amount) => {
      const settings = this.#readDisplaySettings();
      if (["dock-top", "dock-bottom"].includes(settings.insightPosition)) {
        settings.insightDockHeight = Math.min(window.innerHeight * 0.65, Math.max(220, settings.insightDockHeight + amount));
      } else if (["dock-left", "dock-right"].includes(settings.insightPosition)) {
        settings.insightDockWidth = Math.min(window.innerWidth * 0.55, Math.max(300, settings.insightDockWidth + amount));
      } else return;
      localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
      this.#applyDisplaySettings(settings);
    };
    handle.addEventListener("keydown", (event) => {
      const position = document.body.dataset.insightsPosition;
      const direction = ["dock-top", "dock-bottom"].includes(position)
        ? (position === "dock-top"
          ? ({ ArrowUp: -16, ArrowDown: 16 })[event.key]
          : ({ ArrowUp: 16, ArrowDown: -16 })[event.key])
        : ({ ArrowLeft: position === "dock-right" ? 16 : -16, ArrowRight: position === "dock-right" ? -16 : 16 })[event.key];
      if (direction == null) return;
      event.preventDefault();
      resizeBy(direction);
    });
    handle.addEventListener("pointerdown", (event) => {
      const position = document.body.dataset.insightsPosition;
      if (this.mobileMedia.matches) {
        event.preventDefault();
        const overlay = document.querySelector("#insights-overlay");
        const startY = event.clientY;
        const startHeight = overlay.getBoundingClientRect().height;
        document.body.classList.add("insights-resizing");
        const move = (moveEvent) => {
          const height = Math.min(window.innerHeight * 0.45, Math.max(window.innerHeight * 0.25, startHeight + moveEvent.clientY - startY));
          document.body.style.setProperty("--insights-overlay-height", `${height}px`);
        };
        const finish = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          document.body.classList.remove("insights-resizing");
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
        return;
      }
      if (!["dock-left", "dock-right", "dock-top", "dock-bottom"].includes(position)) return;
      event.preventDefault();
      const settings = this.#readDisplaySettings();
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = settings.insightDockWidth;
      const startHeight = settings.insightDockHeight;
      document.body.classList.add("insights-resizing");
      const move = (moveEvent) => {
        if (["dock-top", "dock-bottom"].includes(position)) {
          const delta = position === "dock-top" ? moveEvent.clientY - startY : startY - moveEvent.clientY;
          settings.insightDockHeight = Math.min(window.innerHeight * 0.65, Math.max(220, startHeight + delta));
        } else {
          const delta = position === "dock-left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
          settings.insightDockWidth = Math.min(window.innerWidth * 0.55, Math.max(300, startWidth + delta));
        }
        this.#applyDisplaySettings(settings);
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.body.classList.remove("insights-resizing");
        localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
        this.mapController.resize();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    });
  }

  #bindUtilityPanel() {
    const handle = document.querySelector("#utility-resizer");
    const setWidth = (width, save = false) => {
      const settings = this.#readDisplaySettings();
      settings.utilityPanelWidth = Math.min(window.innerWidth * 0.55, Math.max(280, width));
      document.body.style.setProperty("--utility-panel-width", `${settings.utilityPanelWidth}px`);
      if (save) localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
      requestAnimationFrame(() => this.mapController.resize());
    };
    handle.addEventListener("keydown", (event) => {
      const delta = ({ ArrowLeft: 20, ArrowRight: -20 })[event.key];
      if (delta == null) return;
      event.preventDefault();
      setWidth(this.#readDisplaySettings().utilityPanelWidth + delta, true);
    });
    handle.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = this.#readDisplaySettings().utilityPanelWidth;
      document.body.classList.add("utility-resizing");
      const move = (moveEvent) => setWidth(startWidth + startX - moveEvent.clientX);
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        document.body.classList.remove("utility-resizing");
        const width = parseFloat(getComputedStyle(document.body).getPropertyValue("--utility-panel-width"));
        setWidth(width, true);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
    });
  }

  #serviceDialog(serviceType) {
    const isWms = serviceType === "wms";
    const isWfs = serviceType === "wfs";
    const isGeoJson = serviceType === "geojson";
    const title = isWms ? "Add WMS service" : isWfs ? "Add WFS service" : isGeoJson ? "Add GeoJSON URL / feed" : "Add ArcGIS REST service";
    const placeholder = isWms
      ? "https://server.example/geoserver/wms"
      : isWfs
        ? "https://server.example/geoserver/wfs?SERVICE=WFS&REQUEST=GetFeature&TYPENAMES=workspace:layer"
      : isGeoJson
        ? "https://example.org/data/feed.geojson"
        : "https://server.example/arcgis/rest/services/...";
    this.openDialog({
      eyebrow: isGeoJson ? "Open vector data feed" : isWms || isWfs ? "Open geospatial service" : "ArcGIS Enterprise / Online",
      title,
      content: `<label class="field"><span>${isGeoJson ? "GeoJSON URL" : isWfs ? "WFS endpoint or GetFeature URL" : "Service URL"}</span><input id="service-url" type="url" placeholder="${placeholder}" /></label>
        <label class="field"><span>Layer title <small>optional</small></span><input id="service-title" /></label>
        ${isWfs ? '<label class="field"><span>Feature type <small>optional when included as TYPENAME in the URL</small></span><input id="wfs-name" placeholder="workspace:layer_name" /></label>' : ""}
        ${isWms || isWfs || isGeoJson ? "" : `<label class="field"><span>Service type</span><select id="service-type"><option value="arcgis-auto">Detect automatically</option><option value="feature">Feature service / layer</option><option value="map-image">Map service</option><option value="imagery">Image service</option></select></label>`}
        <label class="field"><span>Refresh every <small>minutes; 0 disables</small></span><input id="service-refresh" type="number" min="0" step="0.5" value="0" /></label>
        <p class="form-note">${isGeoJson ? "The URL must return RFC 7946 GeoJSON and allow browser requests through CORS. It will load as a native ArcGIS GeoJSONLayer with querying, styling, tables, and refresh support." : isWfs ? "Requires WFS 2.0, GeoJSON output advertised by the server, and browser CORS access. Full GetFeature URLs are reduced to the service endpoint and their TYPENAME is detected automatically." : "Layer URLs and FeatureServer /query URLs are supported. Query URLs apply their where and outFields parameters; geometry is projected into the map automatically. The remote server must allow cross-origin browser requests (CORS)."}</p>`,
      actions: [{ label: isGeoJson ? "Add GeoJSON feed" : isWfs ? "Add WFS layer" : "Add service", primary: true, handler: async () => {
        const button = this.dialog.querySelector(".button--primary");
        button.disabled = true;
        button.textContent = "Adding…";
        try {
          const layer = await this.#addServiceOrBrowse({
            url: this.dialog.querySelector("#service-url").value,
            title: this.dialog.querySelector("#service-title").value,
            serviceType: isWms ? "wms" : isWfs ? "wfs" : isGeoJson ? "geojson" : this.dialog.querySelector("#service-type").value,
            wfsName: isWfs ? this.dialog.querySelector("#wfs-name").value : undefined,
            refreshInterval: Number(this.dialog.querySelector("#service-refresh").value),
          });
          if (!layer) return;
          this.dialog.close();
          this.toast(`${layer.title} added.`);
          await this.mapController.goToLayerOnInitialLoad(layer).catch(() => {});
        } catch (error) {
          button.disabled = false;
            button.textContent = isGeoJson ? "Add GeoJSON feed" : isWfs ? "Add WFS layer" : "Add service";
          this.error(error.message);
        }
      }}],
    });
  }

  #popularDataDialog() {
    this.openDialog({
      eyebrow: "Starter catalog",
      title: "Popular data services",
      content: `<section class="server-directory-card" aria-labelledby="server-directory-title">
        <div>
          <span class="eyebrow">MappingSupport.com</span>
          <h3 id="server-directory-title">GIS Server Directory</h3>
          <p>Search the original directory of public government ArcGIS servers, then paste a selected top-level endpoint below.</p>
          <a href="https://mappingsupport.com/p/surf_gis/list-federal-state-county-city-GIS-servers.pdf" target="_blank" rel="noopener noreferrer">Open the original GIS Server Directory (PDF) ↗</a>
        </div>
        <div id="server-directory-form" class="server-directory-form">
          <label class="field" for="server-directory-url"><span>ArcGIS server endpoint</span></label>
          <div class="server-directory-input">
            <input id="server-directory-url" type="url" spellcheck="false" placeholder="https://server.example/arcgis/rest/services" />
            <button id="server-directory-browse" type="button">Browse services</button>
          </div>
          <p class="form-note">Use a top-level address ending in <code>/rest/services</code>. GIS Map reads its folders and services live; the directory itself is not copied or indexed.</p>
        </div>
      </section>
      <div class="catalog-list">${POPULAR_SERVICES.map((service) => `
        <article class="catalog-card">
          <div><span class="eyebrow">${escapeHtml(service.provider)}</span><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p></div>
          <button type="button" data-catalog-id="${escapeHtml(service.id)}">Add</button>
        </article>`).join("")}</div><p class="form-note">Edit <code>js/catalog.js</code> to curate this list.</p>`,
    });
    this.dialog.querySelector("#server-directory-browse").addEventListener("click", async () => {
      try {
        const rootUrl = normalizeArcGisDirectoryUrl(this.dialog.querySelector("#server-directory-url").value);
        const hostname = new URL(rootUrl).hostname;
        await this.#enterpriseCatalogDialog({
          id: "external-directory",
          title: `${hostname} services`,
          rootUrl,
          version: "Live ArcGIS server directory",
        });
      } catch (error) {
        this.error(error.message);
      }
    });
    this.dialog.querySelectorAll("[data-catalog-id]").forEach((button) =>
      button.addEventListener("click", async () => {
        const service = POPULAR_SERVICES.find((item) => item.id === button.dataset.catalogId);
        button.disabled = true;
        try {
          const layer = await this.#addServiceOrBrowse(service);
          if (layer) {
            button.textContent = "Added";
            this.toast(`${service.title} added.`);
          }
        } catch (error) {
          button.disabled = false;
          this.error(error.message);
        }
      }),
    );
  }

  async #addServiceOrBrowse(config) {
    const url = config.url?.trim().replace(/\/+$/, "");
    if (/\/FeatureServer$/i.test(url || "")) {
      const layers = await this.mapController.discoverFeatureServiceLayers(url);
      if (!layers.length) throw new Error("This FeatureServer does not advertise any feature layers.");
      if (layers.length === 1) return this.mapController.addService({ ...config, url: layers[0].url, title: config.title || layers[0].name });
      this.#featureServiceLayersDialog(config, layers);
      return null;
    }
    return this.mapController.addService(config);
  }

  #featureServiceLayersDialog(config, layers) {
    this.openDialog({
      eyebrow: "ArcGIS feature service",
      title: config.title?.trim() || "Select layers",
      content: `<div class="feature-service-actions"><p class="form-note">This service contains multiple layers. Add individual datasets or bring them all into the map at once.</p><button type="button" data-add-all-feature-service>Add all layers</button></div>
        <div class="enterprise-list">${layers.map((layer) => `<div class="enterprise-row">
          <span><strong>${escapeHtml(layer.name)}</strong><small>${escapeHtml(layer.geometryType)} · Layer ${layer.id}</small></span>
          <button type="button" data-feature-service-layer="${escapeHtml(layer.url)}">Add</button>
        </div>`).join("")}</div>`,
    });
    const addLayer = async (layerInfo, button, { zoom = true } = {}) => {
      button.disabled = true;
      button.textContent = "Adding…";
      try {
        const layer = await this.mapController.addService({
          ...config,
          url: layerInfo.url,
          title: layerInfo.name,
          serviceType: "feature",
        });
        button.textContent = "Added";
        if (zoom) await this.mapController.goToLayerOnInitialLoad(layer).catch(() => {});
        return layer;
      } catch (error) {
        button.disabled = false;
        button.textContent = "Add";
        throw error;
      }
    };
    this.dialog.querySelectorAll("[data-feature-service-layer]").forEach((button) =>
      button.addEventListener("click", async () => {
        const layerInfo = layers.find((item) => item.url === button.dataset.featureServiceLayer);
        try {
          const layer = await addLayer(layerInfo, button);
          this.toast(`${layer.title} added.`);
        } catch (error) {
          this.error(error.message);
        }
      }),
    );
    this.dialog.querySelector("[data-add-all-feature-service]")?.addEventListener("click", async (event) => {
      const addAllButton = event.currentTarget;
      addAllButton.disabled = true;
      const added = [];
      const failures = [];
      for (let index = 0; index < layers.length; index += 1) {
        const layerInfo = layers[index];
        const layerButton = this.dialog.querySelector(`[data-feature-service-layer="${CSS.escape(layerInfo.url)}"]`);
        if (layerButton?.textContent === "Added") continue;
        addAllButton.textContent = `Adding ${index + 1} of ${layers.length}…`;
        try {
          const layer = await addLayer(layerInfo, layerButton, { zoom: false });
          added.push(layer);
        } catch (error) {
          failures.push(layerInfo.name);
        }
      }
      addAllButton.textContent = failures.length ? "Retry failed layers" : "All layers added";
      addAllButton.disabled = failures.length === 0;
      if (added[0]) await this.mapController.goToLayerOnInitialLoad(added[0]).catch(() => {});
      if (added.length) this.toast(`${added.length} layer${added.length === 1 ? "" : "s"} added.`);
      if (failures.length) this.error(`Could not add: ${failures.join(", ")}.`);
    });
  }

  async #enterpriseCatalogDialog(catalogIdOrDefinition) {
    const definition = typeof catalogIdOrDefinition === "string"
      ? ENTERPRISE_CATALOGS.find((item) => item.id === catalogIdOrDefinition)
      : catalogIdOrDefinition;
    if (!definition) throw new Error("That ArcGIS service directory is not configured.");
    const catalog = new EnterpriseCatalog(definition);
    this.openDialog({
      eyebrow: definition.version,
      title: definition.title,
      content: '<div class="loading-row"><span></span> Reading service directory…</div>',
    });

    const render = async (folder = "") => {
      const content = document.querySelector("#dialog-content");
      content.innerHTML = '<div class="loading-row"><span></span> Reading service directory…</div>';
      try {
        const listing = await catalog.browse(folder);
        const parent = listing.folder.includes("/")
          ? listing.folder.split("/").slice(0, -1).join("/")
          : "";
        content.innerHTML = `<div class="catalog-path"><button data-enterprise-folder="${escapeHtml(parent)}" ${listing.folder ? "" : "disabled"}>← Back</button><code>/${escapeHtml(listing.folder)}</code></div>
          <div class="enterprise-list">
            ${listing.folders.map((name) => `<button class="enterprise-row" data-enterprise-folder="${escapeHtml(name)}"><span><strong>${escapeHtml(name.split("/").pop())}</strong><small>Folder</small></span><b>→</b></button>`).join("")}
            ${listing.services.map((service) => `<div class="enterprise-row"><span><strong>${escapeHtml(service.name.split("/").pop())}</strong><small>${escapeHtml(service.type)}</small></span><button data-enterprise-service="${escapeHtml(service.url)}" data-service-type="${escapeHtml(service.serviceType)}">Add</button></div>`).join("")}
          </div>
          ${!listing.folders.length && !listing.services.length ? '<div class="empty-state">This folder is empty.</div>' : ""}
          <p class="form-note">Services are discovered live from <code>${escapeHtml(definition.rootUrl)}</code>. Availability and access are controlled by the service owner.</p>`;
        content.querySelectorAll("[data-enterprise-folder]").forEach((button) =>
          button.addEventListener("click", () => render(button.dataset.enterpriseFolder)),
        );
        content.querySelectorAll("[data-enterprise-service]").forEach((button) =>
          button.addEventListener("click", async () => {
            button.disabled = true;
            button.textContent = "Adding…";
            try {
              const layer = await this.mapController.addService({
                url: button.dataset.enterpriseService,
                serviceType: button.dataset.serviceType,
              });
              button.textContent = "Added";
              this.toast(`${layer.title} added.`);
              await this.mapController.goToLayerOnInitialLoad(layer).catch(() => {});
            } catch (error) {
              button.disabled = false;
              button.textContent = "Add";
              this.error(error.message);
            }
          }),
        );
      } catch (error) {
        content.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}<br />The server may not allow cross-origin browser access.</div>`;
      }
    };
    await render();
  }

  #customToolDialog() {
    this.openDialog({
      eyebrow: "Extensibility",
      title: "Load a custom JavaScript tool",
      content: `<div class="warning-box"><strong>Only load code you trust.</strong><p>A local module runs with this page's browser permissions. It can access map data and browser storage.</p></div><p class="form-note">Contract: export a default async function receiving <code>{ events, map, view, getLayers }</code>. Return an object with an optional <code>id</code> and <code>title</code>.</p>`,
      actions: [{ label: "Choose JavaScript file", primary: true, handler: () => {
        this.dialog.close();
        document.querySelector("#tool-file-input").click();
      }}],
    });
  }

  #connectionsDialog() {
    const callbackUrl = this.authController.getCallbackUrl();
    const redirectUrl = this.authController.getRedirectUrl();
    const connections = this.authController.list();
    const connectionCards = connections.length
      ? connections.map((connection) => {
          const url = connection.type === "portal" ? connection.portalUrl : connection.serverUrl;
          return `<article class="connection-card" data-connection-id="${escapeHtml(connection.id)}">
            <div class="connection-card__head">
              <div><strong>${escapeHtml(connection.name)}</strong><small>${connection.type === "portal" ? `Portal OAuth · ${connection.loginMode || "popup"}` : connection.authMode === "web-tier" ? "Standalone Server · web-tier" : "Standalone Server · token"}</small></div>
              <span class="connection-badge" data-connection-status>Checking…</span>
            </div>
            <code title="${escapeHtml(url)}">${escapeHtml(url)}</code>
            <div class="connection-card__actions">
              <button type="button" data-connect-id="${escapeHtml(connection.id)}">Connect</button>
              <button type="button" data-test-connection-id="${escapeHtml(connection.id)}">Test</button>
              <button type="button" class="button--quiet" data-remove-connection="${escapeHtml(connection.id)}">Remove</button>
            </div>
          </article>`;
        }).join("")
      : '<div class="empty-state">No ArcGIS identity connections are configured in this browser.</div>';

    this.openDialog({
      eyebrow: "IdentityManager + OAuthInfo",
      title: "ArcGIS connections",
      content: `<section class="connection-manager">
          <div id="connection-list" class="connection-list">${connectionCards}</div>

          <details class="connection-setup" open>
            <summary>Add Portal or ArcGIS Online</summary>
            <div class="connection-setup__body">
              <div class="field-grid">
                <label class="field"><span>Connection name <small>optional</small></span><input id="portal-connection-name" placeholder="Acme GIS" /></label>
                <label class="field"><span>Portal URL</span><input id="portal-connection-url" type="url" value="https://www.arcgis.com" placeholder="https://gis.example.com/portal" /></label>
              </div>
              <label class="field"><span>GIS Map application / Client ID</span><input id="portal-client-id" autocomplete="off" placeholder="Public OAuth application ID" /></label>
              <label class="field"><span>Sign-in presentation</span><select id="portal-login-mode"><option value="popup">Popup window</option><option value="redirect">Full-page redirect</option></select></label>
              <label class="field"><span>URI to register for popup mode</span><div class="copy-field"><input id="portal-callback-url" readonly value="${escapeHtml(callbackUrl)}" /><button type="button" data-copy-uri="${escapeHtml(callbackUrl)}">Copy</button></div></label>
              <label class="field"><span>URI to register for redirect mode</span><div class="copy-field"><input id="portal-redirect-url" readonly value="${escapeHtml(redirectUrl)}" /><button type="button" data-copy-uri="${escapeHtml(redirectUrl)}">Copy</button></div></label>
              <button type="button" id="add-portal-connection" class="inline-primary">Save &amp; connect</button>
              <p class="form-note">The organization administrator registers GIS Map Online once and supplies this public Client ID. Sign-in uses OAuth authorization code + PKCE when supported; no client secret belongs in this browser app.</p>
            </div>
          </details>

          <details class="connection-setup">
            <summary>Standalone ArcGIS Server — token authentication</summary>
            <div class="connection-setup__body">
              <label class="field"><span>Connection name <small>optional</small></span><input id="token-server-name" placeholder="Parcel server" /></label>
              <label class="field"><span>ArcGIS Server root URL</span><input id="token-server-url" type="url" placeholder="https://gis.example.com/server" /></label>
              <label class="field"><span>Token service URL <small>discovered automatically when possible</small></span><input id="token-server-token-url" type="url" placeholder="https://gis.example.com/server/tokens/generateToken" /></label>
              <button type="button" id="add-token-server" class="inline-primary">Save &amp; connect</button>
              <p class="form-note">Use this only for a secured, non-federated ArcGIS Server. IdentityManager owns the credential challenge and token; GIS Map Online does not read or serialize the username, password, or token.</p>
            </div>
          </details>

          <details class="connection-setup">
            <summary>Standalone ArcGIS Server — web-tier authentication <small>advanced</small></summary>
            <div class="connection-setup__body">
              <label class="field"><span>Connection name <small>optional</small></span><input id="web-server-name" placeholder="Internal GIS" /></label>
              <label class="field"><span>ArcGIS Server root URL</span><input id="web-server-url" type="url" placeholder="https://gis.internal.example/arcgis" /></label>
              <button type="button" id="add-web-server" class="inline-primary">Save &amp; test browser access</button>
              <p class="form-note">For IWA, PKI, or reverse-proxy authentication managed by the browser and web tier. This requires correct TLS, credentialed CORS, and usually the organization's network or VPN.</p>
            </div>
          </details>

          <section id="connection-test-report" class="connection-report" hidden></section>

          <div class="warning-box connection-security"><strong>Project portability and security</strong><p>Connection names, URLs, and public Client IDs are saved locally and included in project exports. Credentials and access tokens are never added to a .gmo or .gmop file. Imported projects require a fresh sign-in. The Portal/Server must use HTTPS and allow this site through CORS.</p></div>
        </section>`,
      actions: connections.length ? [{ label: "Sign out all", handler: () => {
        this.authController.signOutAll();
        this.#connectionsDialog();
        this.toast("Signed out of ArcGIS connections for this browser session.");
      }}] : [],
    });

    const setBusy = (button, busy, label) => {
      button.disabled = busy;
      button.textContent = busy ? "Connecting…" : label;
    };
    const renderReport = (report) => {
      const target = this.dialog.querySelector("#connection-test-report");
      const rows = [
        ["Endpoint", report.url],
        ["ArcGIS version", report.version || "Not reported"],
        ["Authentication", report.authentication],
        ["Token endpoint", report.tokenServiceUrl || "Not advertised"],
        ["CORS", report.cors ? "Browser request succeeded" : "Failed"],
        ["Federated", report.federated == null ? "Not applicable" : report.federated ? "Yes" : "No"],
        ["Owning Portal", report.owningSystemUrl || "None"],
        ["Organization", report.organization || "Not reported"],
        ["Response time", `${report.responseMs} ms`],
      ];
      target.innerHTML = `<strong>Connection test</strong><dl>${rows.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`).join("")}</dl>${report.federated && !report.portalConnectionId ? `<p>Add the owning Portal above with an OAuth Client ID. Federated Server credentials must be issued by that Portal.</p>` : ""}`;
      target.hidden = false;
      target.scrollIntoView({ block: "nearest" });
    };
    this.dialog.querySelectorAll("[data-copy-uri]").forEach((button) => button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(button.dataset.copyUri);
        this.toast("URI copied.");
      } catch {
        button.previousElementSibling.select();
        this.toast("URI selected. Copy it from the field.");
      }
    }));
    this.dialog.querySelector("#add-portal-connection").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, "Save & connect");
      try {
        const connection = this.authController.addPortal({
          name: this.dialog.querySelector("#portal-connection-name").value,
          portalUrl: this.dialog.querySelector("#portal-connection-url").value,
          clientId: this.dialog.querySelector("#portal-client-id").value,
          loginMode: this.dialog.querySelector("#portal-login-mode").value,
        });
        await this.authController.connect(connection.id);
        this.#connectionsDialog();
      } catch (error) {
        setBusy(button, false, "Save & connect");
        this.error(error.message);
      }
    });
    this.dialog.querySelector("#add-token-server").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, "Save & connect");
      try {
        const serverUrl = this.dialog.querySelector("#token-server-url").value;
        const report = await this.authController.inspectServer(serverUrl, "token");
        if (report.federated) throw new Error(`This Server is federated. Add its owning Portal (${report.owningSystemUrl}) and use Portal OAuth instead.`);
        const connection = this.authController.addServer({
          name: this.dialog.querySelector("#token-server-name").value,
          serverUrl,
          tokenServiceUrl: this.dialog.querySelector("#token-server-token-url").value || report.tokenServiceUrl,
          authMode: "token",
        });
        await this.authController.connect(connection.id);
        this.#connectionsDialog();
      } catch (error) {
        setBusy(button, false, "Save & connect");
        this.error(error.message);
      }
    });
    this.dialog.querySelector("#add-web-server").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, "Save & test browser access");
      try {
        const serverUrl = this.dialog.querySelector("#web-server-url").value;
        const report = await this.authController.inspectServer(serverUrl, "web-tier");
        if (report.federated) throw new Error(`This Server is federated. Add its owning Portal (${report.owningSystemUrl}) and use Portal OAuth instead.`);
        this.authController.addServer({
          name: this.dialog.querySelector("#web-server-name").value,
          serverUrl,
          authMode: "web-tier",
        });
        this.#connectionsDialog();
      } catch (error) {
        setBusy(button, false, "Save & test browser access");
        this.error(error.message);
      }
    });
    this.dialog.querySelectorAll("[data-connect-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        setBusy(button, true, "Connect");
        try {
          await this.authController.connect(button.dataset.connectId);
          this.#connectionsDialog();
        } catch (error) {
          setBusy(button, false, "Connect");
          this.error(error.message);
        }
      });
    });
    this.dialog.querySelectorAll("[data-test-connection-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        setBusy(button, true, "Test");
        try {
          renderReport(await this.authController.testConnection(button.dataset.testConnectionId));
          setBusy(button, false, "Test");
        } catch (error) {
          setBusy(button, false, "Test");
          this.error(error.message);
        }
      });
    });
    this.dialog.querySelectorAll("[data-remove-connection]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!confirm("Remove this connection definition and sign out of all ArcGIS connections?")) return;
        this.authController.remove(button.dataset.removeConnection);
        this.#connectionsDialog();
      });
    });
    this.authController.getStatuses().then((items) => {
      for (const { connection, status } of items) {
        const card = this.dialog.querySelector(`[data-connection-id="${CSS.escape(connection.id)}"]`);
        const badge = card?.querySelector("[data-connection-status]");
        const connect = card?.querySelector("[data-connect-id]");
        if (!badge) continue;
        badge.textContent = status.signedIn ? status.userId || "Connected" : "Not signed in";
        badge.classList.toggle("is-connected", status.signedIn);
        if (connect) connect.textContent = status.signedIn ? "Reconnect" : "Connect";
      }
    }).catch(() => {});
  }

  #aiDialog() {
    const config = this.aiController.config ?? {};
    const provider = config.provider || "ollama";
    const appOrigin = location.origin;
    const defaults = {
      ollama: ["http://localhost:11434", "llama3.2"],
      openai: ["https://api.openai.com/v1", "gpt-6-astra"],
      anthropic: ["https://api.anthropic.com/v1", "claude-sonnet-5"],
      "openai-compatible": ["", ""],
    };
    const readForm = () => ({
      provider: this.dialog.querySelector("#ai-provider").value,
      endpoint: this.dialog.querySelector("#ai-endpoint").value,
      model: this.dialog.querySelector("#ai-model").value,
      token: this.dialog.querySelector("#ai-token").value,
    });
    const setConnectionStatus = (state, message) => {
      const status = this.dialog.querySelector("#ai-connection-status");
      status.className = `connection-status connection-status--${state}`;
      status.textContent = message;
      status.hidden = false;
    };
    const testConnection = async () => {
      const pending = readForm();
      const isOllama = pending.provider === "ollama";
      setConnectionStatus("testing", isOllama ? "Checking Ollama and installed models…" : "Checking provider credentials and model access…");
      try {
        const result = await this.aiController.testConnection(pending);
        if (isOllama) {
          this.dialog.querySelector("#ollama-models").innerHTML = result.models
            .map((name) => `<option value="${escapeHtml(name)}"></option>`)
            .join("");
          setConnectionStatus(
            "success",
            `Connected. ${result.models.length} installed model${result.models.length === 1 ? "" : "s"} found.`,
          );
        } else {
          setConnectionStatus("success", `Connected. ${result.model || pending.model} is available to this API key.`);
        }
        return result;
      } catch (error) {
        setConnectionStatus("error", error.message);
        throw error;
      }
    };
    const actions = [];
    if (config.provider) {
      actions.push({ label: "Disable AI", handler: () => {
        this.aiController.disable();
        this.dialog.close();
        this.toast("AI intelligence disabled.");
      }});
    }
    actions.push({ label: "Test connection", handler: async () => {
      try {
        await testConnection();
      } catch (error) {
        this.error(error.message);
      }
    }});
    actions.push({ label: "Use for this tab", primary: true, handler: async () => {
      const button = this.dialog.querySelector(".button--primary");
      button.disabled = true;
      button.textContent = "Checking…";
      try {
        const pending = readForm();
        if (pending.provider === "ollama") await testConnection();
        this.aiController.configure(pending);
        this.dialog.close();
        this.toast("AI enabled for this tab.");
      } catch (error) {
        this.error(error.message);
      } finally {
        button.disabled = false;
        button.textContent = "Use for this tab";
      }
    }});
    this.openDialog({
      eyebrow: "AI adapter",
      title: "Configure intelligence provider",
      content: `<label class="field"><span>Provider</span><select id="ai-provider"><option value="ollama" ${provider === "ollama" ? "selected" : ""}>Ollama (local)</option><option value="openai" ${provider === "openai" ? "selected" : ""}>OpenAI</option><option value="anthropic" ${provider === "anthropic" ? "selected" : ""}>Anthropic Claude</option><option value="openai-compatible" ${provider === "openai-compatible" ? "selected" : ""}>OpenAI-compatible endpoint</option></select></label>
        <label class="field"><span>Endpoint</span><input id="ai-endpoint" type="url" value="${escapeHtml(config.endpoint || defaults[provider][0])}" /></label>
        <label class="field"><span>Model</span><input id="ai-model" list="ollama-models" value="${escapeHtml(config.model || defaults[provider][1])}" /><datalist id="ollama-models"></datalist><small id="ai-model-hint">Use the complete Ollama tag, including a suffix such as <code>:27b</code>.</small></label>
        <label class="field"><span>API token <small>online providers only</small></span><input id="ai-token" type="password" autocomplete="off" /></label>
        <section id="ollama-setup" class="ollama-setup" ${provider === "ollama" ? "" : "hidden"}>
          <strong>One-time Ollama browser access on macOS</strong>
          <p>Ollama must allow this exact site origin. Run this in Terminal:</p>
          <code>launchctl setenv OLLAMA_ORIGINS &quot;${escapeHtml(appOrigin)}&quot;</code>
          <p>Then fully quit Ollama from its menu-bar icon, reopen it, and choose <b>Test Ollama</b>.</p>
          <small>Keeping the permission scoped to ${escapeHtml(appOrigin)} is safer than using <code>*</code>. Ollama's local API has no authentication.</small>
        </section>
        <div id="ai-connection-status" class="connection-status" hidden></div>
        <p class="form-note">Provider, endpoint, and model may be remembered locally. API tokens remain only in page memory and are never saved or exported; re-enter them after a reload. Direct browser keys are appropriate only for personal testing. Use a controlled proxy for a public paid service.</p>
        <p class="form-note"><a href="/ai-connection-guide/" target="_blank" rel="noopener">Read the AI connection guide ↗</a></p>`,
      actions,
    });
    const providerInput = this.dialog.querySelector("#ai-provider");
    const syncProviderForm = () => {
      const [endpoint, model] = defaults[providerInput.value];
      if (document.activeElement === providerInput) {
        this.dialog.querySelector("#ai-endpoint").value = endpoint;
        this.dialog.querySelector("#ai-model").value = model;
      }
      this.dialog.querySelector("#ollama-setup").hidden = providerInput.value !== "ollama";
      this.dialog.querySelector("#ai-model-hint").innerHTML = providerInput.value === "ollama"
        ? 'Use the complete Ollama tag, including a suffix such as <code>:27b</code>.'
        : providerInput.value === "openai"
          ? "Enter an OpenAI API model identifier available to this API key. OpenAI uses the Responses API."
          : "Enter the model identifier accepted by this provider.";
      this.dialog.querySelector("#ai-connection-status").hidden = true;
    };
    providerInput.addEventListener("change", syncProviderForm);
    syncProviderForm();
  }

  #aboutDialog() {
    this.openDialog({
      eyebrow: "Foundation build",
      title: "GIS Map Online",
      content: `<div class="about-copy"><p>A browser-only GIS viewer built around ArcGIS Maps SDK for JavaScript 5.0 and a topic-based event bus.</p><p><a href="/examples/">Browse public GIS examples</a> or read the <a href="/arcgis-rest-service-viewer/">viewer guides</a>.</p><dl><div><dt>Runtime</dt><dd>Static HTML + ES modules</dd></div><div><dt>Persistence</dt><dd>localStorage + portable ZIP</dd></div><div><dt>Identify</dt><dd>Popup-free normalized results</dd></div><div><dt>Identity</dt><dd>Optional ArcGIS OAuth / token authentication managed by the Esri SDK</dd></div><div><dt>Privacy</dt><dd>No GIS Map Online account or database; credentials are excluded from projects</dd></div></dl></div>`,
    });
  }

  #presentationLayer(presentation) {
    const layers = this.mapController.getOperationalLayers();
    return layers.find((layer) => layer.uid === presentation.primaryLayerId && typeof layer.queryFeatures === "function")
      || layers.find((layer) => typeof layer.queryFeatures === "function")
      || null;
  }

  #presentationFields(layer) {
    const fields = (layer?.fields || []).filter((field) => field?.name && !/^(objectid|shape|fid)$/i.test(field.name));
    const text = fields.filter((field) => /string|guid|oid/i.test(field.type || ""));
    const numeric = fields.filter((field) => /small-integer|integer|single|double|long/i.test(field.type || ""));
    const dates = fields.filter((field) => /date/i.test(field.type || ""));
    return { fields, text, numeric, dates };
  }

  #presentationRoles(presentation, layer, fields = this.#presentationFields(layer)) {
    const mappings = presentation.fieldMappings || {};
    const names = new Set(fields.fields.map((field) => field.name));
    const mapped = (role) => names.has(mappings[role]) ? mappings[role] : null;
    const matching = (list, pattern) => list.find((field) => pattern.test(`${field.name} ${field.alias || ""}`))?.name || null;
    return {
      title: mapped("title") || matching(fields.text, /location|station|site|name|title/i) || fields.text[0]?.name || null,
      metric: mapped("metric") || matching(fields.numeric, /value|measure|concentration|amount|magnitude|score/i) || fields.numeric[0]?.name || null,
      // UnitID-style fields are commonly organizational identifiers. Only an
      // explicit mapping or a schema field named exactly "unit" is trusted.
      unit: mapped("unit") || fields.text.find((field) => /^(unit|units|uom)$/i.test(field.name))?.name || null,
      timestamp: mapped("timestamp") || matching([...fields.dates, ...fields.text], /observ|measure|sample|date|time|updated/i),
      category: mapped("category"),
      source: mapped("source") || matching(fields.text, /^(?:url|source_url|link)$/i),
    };
  }

  async #loadPresentationRecords(presentation) {
    const layer = this.#presentationLayer(presentation);
    const prior = this.presentationState.template === presentation.template ? this.presentationState : {};
    this.briefingRequest.cancel();
    this.presentationState = { ...prior, template: presentation.template, layerUid: layer?.uid || null, records: [], visibleRecords: [], selected: null, selectedIds: new Set(), search: "", searchField: "*", searchOperator: "contains", chartField: null, scope: "all", rangeMin: null, rangeMax: null, totalCount: null, sortField: null, sortDirection: "asc", page: 1, pageSize: 25, binCount: 12, fetchedAt: new Date().toISOString() };
    if (!layer) return this.#renderPresentationDashboard(presentation);
    try {
      const query = layer.createQuery?.() || {};
      Object.assign(query, { where: layer.definitionExpression || "1=1", outFields: ["*"], returnGeometry: true, num: 500 });
      const response = await layer.queryFeatures(query);
      let totalCount = null;
      try { totalCount = await layer.queryFeatureCount(query); } catch { /* Count metadata is optional. */ }
      if (this.presentationState.layerUid !== layer.uid) return;
      this.presentationState.records = (response.features || []).map((graphic) => ({
        kind: "feature", layerUid: layer.uid, layerTitle: layer.title || "Layer", attributes: graphic.attributes || {}, geometry: graphic.geometry || null, graphic,
      }));
      this.presentationState.totalCount = Number.isFinite(totalCount) ? totalCount : null;
      const fields = this.#presentationFields(layer);
      const roles = this.#presentationRoles(presentation, layer, fields);
      this.presentationState.roles = roles;
      this.presentationState.searchField = roles.title || "*";
      this.presentationState.chartField = roles.metric || fields.numeric[0]?.name || null;
      this.presentationState.sortField = roles.title || fields.fields[0]?.name || null;
      const metricValues = this.presentationState.records.map((record) => Number(record.attributes?.[roles.metric])).filter(Number.isFinite);
      this.presentationState.metricMin = metricValues.length ? Math.min(...metricValues) : null;
      this.presentationState.metricMax = metricValues.length ? Math.max(...metricValues) : null;
      this.presentationState.metricUnit = this.presentationState.records.map((record) => record.attributes?.[roles.unit]).find(Boolean) || "";
      this.#filterPresentationRecords();
    } catch (error) {
      this.presentationState.error = error.message;
      this.#renderPresentationDashboard(presentation);
    }
  }

  #recordLabel(result, fields) {
    const attributes = result.attributes || {};
    const role = this.presentationState.roles?.title;
    const preferred = fields.fields.find((field) => field.name === role) || fields.text.find((field) => /name|title|incident|location|label/i.test(`${field.name} ${field.alias || ""}`)) || fields.text[0];
    return String(attributes[preferred?.name] ?? "Untitled record");
  }

  #filterPresentationRecords() {
    const active = document.activeElement?.matches?.("[data-mode-search]")
      ? { selector: "[data-mode-search]", start: document.activeElement.selectionStart, end: document.activeElement.selectionEnd }
      : null;
    const layer = this.mapController.findLayer(this.presentationState.layerUid);
    const fields = this.#presentationFields(layer);
    const extent = this.mapController.view?.extent;
    const filtered = filterRecords(this.presentationState.records, this.presentationState, fields.fields, (result) => !extent || extent.intersects?.(result.geometry?.extent || result.geometry));
    this.presentationState.visibleRecords = sortRecords(filtered, this.presentationState.sortField, this.presentationState.sortDirection);
    if (this.presentationState.selected && !this.presentationState.visibleRecords.includes(this.presentationState.selected)) {
      this.presentationState.selected = null;
      this.mapController.clearFeatureHighlight();
    }
    void this.#syncExplorerMapFilter(layer, this.presentationState.visibleRecords);
    this.#renderPresentationDashboard(this.projectManager.current.presentation || {});
    if (active) requestAnimationFrame(() => {
      const input = document.querySelector(active.selector);
      if (!input) return;
      input.focus({ preventScroll: true });
      input.setSelectionRange(active.start ?? input.value.length, active.end ?? input.value.length);
    });
  }

  #selectPresentationResult(result) {
    if (!result || this.presentationState.template === "standard") return;
    const layer = this.mapController.findLayer(this.presentationState.layerUid);
    const idField = layer?.objectIdField;
    const selected = idField ? this.presentationState.records.find((record) => featureId(record, idField) === featureId(result, idField)) || result : result;
    this.presentationState.selected = selected;
    this.presentationState.selectedIds = new Set([featureId(selected, idField)].filter(Boolean));
    this.mapController.highlightFeature(selected);
    this.#setInsightsOpen(false);
    this.#renderPresentationDashboard(this.projectManager.current.presentation || {});
  }

  async #syncExplorerMapFilter(layer, records) {
    if (!layer || !this.mapController.view?.whenLayerView) return;
    try {
      const layerView = await this.mapController.view.whenLayerView(layer);
      const objectIdField = layer.objectIdField;
      layerView.filter = objectIdField ? { objectIds: records.map((record) => record.attributes?.[objectIdField]).filter((value) => value != null) } : null;
    } catch { /* Not every layer view supports a client-side object ID filter. */ }
  }

  #applyExplorerMetricRenderer(layer, roles, presentation) {
    if (!roles.metric || layer?.geometryType !== "point") return;
    const unit = this.presentationState.records.map((record) => record.attributes?.[roles.unit]).find(Boolean) || "";
    layer.renderer = {
      type: "simple",
      symbol: { type: "simple-marker", size: 7, color: "#9ca3a0", outline: { color: "#ffffff", width: 0.7 } },
      visualVariables: [{
        type: "color", field: roles.metric,
        legendOptions: { title: `${presentation.widgets?.metricLabel || roles.metric}${unit ? ` (${unit})` : ""}` },
        stops: [
          { value: this.presentationState.metricMin ?? 0, color: "#2f7f9d", label: "Lower" },
          { value: ((this.presentationState.metricMin ?? 0) + (this.presentationState.metricMax ?? 1)) / 2, color: "#e0ad35", label: "Middle" },
          { value: this.presentationState.metricMax ?? 1, color: "#b23f62", label: "Higher" },
        ],
      }],
    };
  }

  #formatExplorerTime(value) {
    if (value == null || value === "") return "Time not supplied";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);
  }

  #formatExplorerNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(number) : "Measurement unavailable";
  }

  #explorerHistogram(records, metric, min, max) {
    if (!metric || !Number.isFinite(min) || !Number.isFinite(max)) return [];
    const bins = Array.from({ length: 12 }, (_, index) => ({ min: min + (max - min) * index / 12, max: min + (max - min) * (index + 1) / 12, count: 0 }));
    records.forEach((record) => {
      const value = Number(record.attributes?.[metric]);
      if (!Number.isFinite(value)) return;
      const index = max === min ? 0 : Math.min(11, Math.floor((value - min) / (max - min) * 12));
      bins[index].count += 1;
    });
    return bins;
  }

  #renderPresentationDashboard(presentation) {
    const root = document.querySelector("#presentation-dashboard");
    if (!root) return;
    const template = presentation.template || "standard";
    if (template === "standard") { root.replaceChildren(); root.hidden = true; return; }
    root.hidden = false;
    const layer = this.mapController.findLayer(this.presentationState.layerUid);
    if (!layer && template !== "atlas") {
      root.innerHTML = `<section class="presentation-empty"><span class="eyebrow">${escapeHtml(template)}</span><h2>Start with a dataset</h2><p>This mode becomes interactive after you add a feature layer. Your project and map remain unchanged.</p><div><button type="button" data-presentation-setup="data-arcgis">Connect a service</button><button type="button" data-presentation-setup="data-file">Add a file</button><button type="button" data-presentation-example>Open an example</button></div></section>`;
      root.querySelectorAll("[data-presentation-setup]").forEach((button) => button.addEventListener("click", () => this.#handleAction(button.dataset.presentationSetup)));
      root.querySelector("[data-presentation-example]")?.addEventListener("click", () => location.assign("/examples/"));
      return;
    }
    const fields = this.#presentationFields(layer);
    const records = this.presentationState.visibleRecords;
    const categories = [...new Set(this.presentationState.records.map((result) => String(result.attributes?.[this.presentationState.categoryField] ?? "")).filter(Boolean))].slice(0, 24);
    const selected = this.presentationState.selected;
    const selectedDetails = selected ? Object.entries(selected.attributes || {}).filter(([, value]) => value != null && value !== "").slice(0, 12) : [];
    if (template === "atlas") {
      const chapters = presentation.chapters || [];
      const playing = Boolean(this.presentationState.atlasPlaying);
      const playbackMode = presentation.playbackMode === "manual" ? "manual" : "auto";
      root.innerHTML = `<section class="mode-dashboard mode-dashboard--atlas"><header><span class="eyebrow">Atlas · ${this.presentationState.atlasPresent ? "present" : "edit"} mode</span><h2>${escapeHtml(presentation.title || "Guided places")}</h2><p>Capture exact map views, descriptions, media, and layer states as a shareable guided tour.</p></header><div class="atlas-present-action"><button type="button" data-atlas-mode>${this.presentationState.atlasPresent ? "Edit chapters" : "Present atlas"}</button></div><label class="atlas-playback-mode"><span>Playback</span><select data-atlas-playback><option value="auto"${playbackMode === "auto" ? " selected" : ""}>Auto · use linger time</option><option value="manual"${playbackMode === "manual" ? " selected" : ""}>Manual · use Back and Next</option></select></label><div class="atlas-actions"><button type="button" data-atlas-capture ${this.presentationState.atlasPresent ? "hidden" : ""}>Add another chapter</button><button type="button" data-atlas-export>Export tour</button></div><div class="mode-records">${chapters.map((chapter, index) => `<article class="atlas-chapter"><button type="button" data-atlas-go="${index}"><span>${index + 1}</span><strong>${escapeHtml(chapter.title || `Chapter ${index + 1}`)}</strong><small>${escapeHtml(chapter.reverseAddress || chapter.body || "Saved map view")}${chapter.basemapId ? ` · ${escapeHtml(this.#basemapLabel(chapter.basemapId))}` : ""}${playbackMode === "auto" && chapter.lingerSeconds ? ` · ${chapter.lingerSeconds}s` : ""}</small></button>${this.presentationState.atlasPresent ? "" : `<div><button type="button" data-atlas-rename="${index}">Edit</button><button type="button" data-atlas-delete="${index}">Delete</button></div>`}</article>`).join("") || "<p class=\"form-note\">No chapters yet. Add another chapter to begin the atlas.</p>"}</div></section>`;
      this.#addPresentationDockControl(root);
      root.querySelector("[data-atlas-mode]")?.addEventListener("click", async () => {
        this.#stopAtlasStory();
        this.presentationState.atlasPresent = !this.presentationState.atlasPresent;
        this.#renderPresentationDashboard(presentation);
        if (this.presentationState.atlasPresent && chapters.length) await this.#goToAtlasChapter(chapters[0], 0, chapters);
        else this.#hideAtlasChapterOverlay();
      });
      root.querySelector("[data-atlas-capture]")?.addEventListener("click", () => this.#captureAtlasChapter());
      root.querySelector("[data-atlas-export]")?.addEventListener("click", () => this.projectManager.exportAtlas());
      root.querySelector("[data-atlas-playback]")?.addEventListener("change", (event) => {
        this.#stopAtlasStory();
        this.projectManager.setPresentation({ ...this.projectManager.current.presentation, playbackMode: event.target.value });
        this.#renderPresentationDashboard(this.projectManager.current.presentation);
      });
      root.querySelectorAll("[data-atlas-go]").forEach((button) => button.addEventListener("click", () => { const index = Number(button.dataset.atlasGo); this.#goToAtlasChapter(chapters[index], index, chapters); }));
      root.querySelectorAll("[data-atlas-delete]").forEach((button) => button.addEventListener("click", () => this.#saveAtlasChapters(chapters.filter((_, index) => index !== Number(button.dataset.atlasDelete)))));
      root.querySelectorAll("[data-atlas-rename]").forEach((button) => button.addEventListener("click", () => this.#editAtlasChapter(chapters, Number(button.dataset.atlasRename))));
      return;
    }
    if (template === "explorer") {
      this.#renderExplorerWorkspace(root, presentation, layer, fields);
      return;
    }
    if (template === "briefing") {
      this.#renderBriefingWorkspace(root, presentation, layer, fields);
      return;
    }
    if (template === "explorer") {
      const roles = this.presentationState.roles || this.#presentationRoles(presentation, layer, fields);
      const loaded = this.presentationState.records.length;
      const total = this.presentationState.totalCount;
      const incomplete = Number.isFinite(total) && total > loaded;
      const unit = this.presentationState.metricUnit || "";
      const units = [...new Set(this.presentationState.records.map((record) => record.attributes?.[roles.unit]).filter(Boolean).map(String))];
      const bins = this.#explorerHistogram(records.filter((record) => !unit || String(record.attributes?.[roles.unit] ?? "") === unit), roles.metric, this.presentationState.metricMin, this.presentationState.metricMax);
      const maxBin = Math.max(1, ...bins.map((bin) => bin.count));
      const metricLabel = presentation.widgets?.metricLabel || fields.fields.find((field) => field.name === roles.metric)?.alias || roles.metric || "Measurement";
      const source = selected?.attributes?.[roles.source];
      const sourceLink = /^https:\/\//i.test(String(source || "")) ? `<a href="${escapeHtml(String(source))}" target="_blank" rel="noopener noreferrer">Open source record ↗</a>` : "";
      root.innerHTML = `<section class="mode-dashboard mode-dashboard--explorer"><header><span class="eyebrow">Explorer · synchronized dataset view</span><h2>${escapeHtml(presentation.title || layer.title || "Explore records")}</h2><div class="explorer-counts"><span><b>${loaded}</b> records loaded</span><span><b>${records.length}</b> match filters</span><span><b>${selected ? 1 : 0}</b> selected</span></div>${incomplete ? `<p class="explorer-coverage">Loaded sample: ${loaded} of ${total} service records. Filters, chart, and map cover the loaded sample.</p>` : `<p class="explorer-coverage">Filters, chart, map, and results cover all ${loaded} records returned to this browser.</p>`}</header><div class="explorer-toolbar"><label class="field"><span>Search loaded records</span><input data-mode-search value="${escapeHtml(this.presentationState.search)}" placeholder="Location, provider, or attribute" /></label><label class="field"><span>Geographic scope</span><select data-mode-scope><option value="all"${this.presentationState.scope === "all" ? " selected" : ""}>All loaded records</option><option value="extent"${this.presentationState.scope === "extent" ? " selected" : ""}>Current map extent</option></select></label>${roles.category && categories.length > 1 && categories.length <= 24 ? `<label class="field"><span>${escapeHtml(presentation.widgets?.categoryLabel || "Category filter")}</span><select data-mode-category><option value="">All categories</option>${categories.map((value) => `<option value="${escapeHtml(value)}"${value === this.presentationState.category ? " selected" : ""}>${escapeHtml(value)}</option>`).join("")}</select></label>` : ""}<div class="explorer-actions"><button type="button" data-mode-zoom>Zoom to results</button><button type="button" class="button--quiet" data-mode-clear>Clear filters</button></div></div>${roles.metric ? `<section class="explorer-distribution"><div><span class="eyebrow">Filtered loaded-record distribution</span><strong>${escapeHtml(metricLabel)}${unit ? ` (${escapeHtml(unit)})` : ""}</strong></div><div class="explorer-histogram" aria-label="Histogram of ${escapeHtml(metricLabel)}">${bins.map((bin) => `<button type="button" data-range-bin-min="${bin.min}" data-range-bin-max="${bin.max}" title="${bin.min.toFixed(1)}–${bin.max.toFixed(1)}: ${bin.count} matching loaded records"><span style="height:${Math.max(4, bin.count / maxBin * 100)}%"></span></button>`).join("")}</div><div class="explorer-range"><label>Minimum<input data-range-min type="number" step="any" value="${this.presentationState.rangeMin ?? ""}" placeholder="${Number(this.presentationState.metricMin).toFixed(1)}" /></label><label>Maximum<input data-range-max type="number" step="any" value="${this.presentationState.rangeMax ?? ""}" placeholder="${Number(this.presentationState.metricMax).toFixed(1)}" /></label></div><div class="explorer-legend"><i></i><span>Lower</span><i></i><span>Middle</span><i></i><span>Higher</span><i class="is-missing"></i><span>Missing</span></div>${units.length > 1 ? `<p class="form-note">Multiple units are present (${units.map(escapeHtml).join(", ")}). The chart and legend use ${escapeHtml(unit)} only; values are never combined across units.</p>` : ""}</section>` : ""}<div class="mode-records explorer-results">${records.map((record, index) => { const attrs = record.attributes || {}; const value = attrs[roles.metric]; return `<button type="button" class="mode-record${record === selected ? " is-selected" : ""}" data-mode-record="${index}"><strong>${escapeHtml(this.#recordLabel(record, fields))}</strong><span>${value == null ? "Measurement unavailable" : `${escapeHtml(this.#formatExplorerNumber(value))}${attrs[roles.unit] ? ` ${escapeHtml(String(attrs[roles.unit]))}` : ""}`}</span><small>${escapeHtml(this.#formatExplorerTime(attrs[roles.timestamp]))}</small></button>`; }).join("") || "<p class=\"form-note\">No loaded records match the active filters.</p>"}</div><aside class="mode-details explorer-details"><span class="eyebrow">Location details</span>${selected ? `<h3>${escapeHtml(this.#recordLabel(selected, fields))}</h3><p class="explorer-measurement">${selected.attributes?.[roles.metric] == null ? "Measurement unavailable" : `${escapeHtml(this.#formatExplorerNumber(selected.attributes[roles.metric]))}${selected.attributes?.[roles.unit] ? ` ${escapeHtml(String(selected.attributes[roles.unit]))}` : ""}`}</p><p><strong>${escapeHtml(presentation.widgets?.timestampLabel || "Reported time")}:</strong> ${escapeHtml(this.#formatExplorerTime(selected.attributes?.[roles.timestamp]))}</p>${sourceLink}<details><summary>Technical attributes</summary><dl>${Object.entries(selected.attributes || {}).filter(([, value]) => value != null && value !== "").map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatAttributeValue(value, fields.fields.find((field) => field.name === key), key))}</dd></div>`).join("")}</dl>${roles.timestamp ? `<p class="form-note">Original timestamp: <code>${escapeHtml(String(selected.attributes?.[roles.timestamp] ?? "Not supplied"))}</code></p>` : ""}</details>` : "<p>Select a result or mapped feature. Selection does not change the filter count.</p>"}</aside>${presentation.widgets?.limitation ? `<p class="explorer-limitation"><strong>Source-data limitation:</strong> ${escapeHtml(presentation.widgets.limitation)}</p>` : ""}</section>`;
    } else {
      const dateField = fields.dates[0];
      root.innerHTML = `<section class="mode-dashboard"><header><span class="eyebrow">${escapeHtml(template)}</span><h2>${escapeHtml(presentation.title || layer.title || "Map data")}</h2><p>${records.length} loaded records · ${dateField ? `timeline field: ${escapeHtml(dateField.alias || dateField.name)}` : "No date field is available for a timeline."}</p></header><div class="mode-records">${records.map((record, index) => `<button type="button" class="mode-record${record === selected ? " is-selected" : ""}" data-mode-record="${index}"><strong>${escapeHtml(this.#recordLabel(record, fields))}</strong></button>`).join("")}</div><aside class="mode-details"><span class="eyebrow">Selected feature</span>${selected ? `<h3>${escapeHtml(this.#recordLabel(selected, fields))}</h3><dl>${selectedDetails.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatAttributeValue(value, fields.fields.find((field) => field.name === key), key))}</dd></div>`).join("")}</dl>` : "<p>Select a feature to view source attributes.</p>"}</aside></section>`;
    }
    root.querySelector("[data-mode-search]")?.addEventListener("input", (event) => {
      this.presentationState.search = event.target.value;
      clearTimeout(this.presentationSearchTimer);
      this.presentationSearchTimer = setTimeout(() => this.#filterPresentationRecords(), 180);
    });
    root.querySelector("[data-mode-category]")?.addEventListener("change", (event) => { this.presentationState.category = event.target.value; this.#filterPresentationRecords(); });
    root.querySelector("[data-mode-scope]")?.addEventListener("change", (event) => { this.presentationState.scope = event.target.value; this.#filterPresentationRecords(); });
    root.querySelectorAll("[data-range-min], [data-range-max]").forEach((input) => input.addEventListener("change", () => {
      const minimum = root.querySelector("[data-range-min]")?.value;
      const maximum = root.querySelector("[data-range-max]")?.value;
      this.presentationState.rangeMin = minimum === "" ? null : Number(minimum);
      this.presentationState.rangeMax = maximum === "" ? null : Number(maximum);
      this.#filterPresentationRecords();
    }));
    root.querySelectorAll("[data-range-bin-min]").forEach((button) => button.addEventListener("click", () => {
      this.presentationState.rangeMin = Number(button.dataset.rangeBinMin);
      this.presentationState.rangeMax = Number(button.dataset.rangeBinMax);
      this.#filterPresentationRecords();
    }));
    root.querySelector("[data-mode-zoom]")?.addEventListener("click", async () => {
      const graphics = this.presentationState.visibleRecords.map((record) => record.graphic).filter(Boolean);
      if (graphics.length) await this.mapController.view?.goTo?.(graphics, { animate: !matchMedia("(prefers-reduced-motion: reduce)").matches });
    });
    root.querySelector("[data-mode-clear]")?.addEventListener("click", () => { this.presentationState.search = ""; this.presentationState.category = ""; this.presentationState.scope = "all"; this.presentationState.rangeMin = null; this.presentationState.rangeMax = null; this.#filterPresentationRecords(); });
    root.querySelectorAll("[data-mode-category-value]").forEach((button) => button.addEventListener("click", () => { this.presentationState.category = button.dataset.modeCategoryValue; this.#filterPresentationRecords(); }));
    root.querySelectorAll("[data-mode-record]").forEach((button) => button.addEventListener("click", async () => { const result = records[Number(button.dataset.modeRecord)]; this.#selectPresentationResult(result); if (result?.geometry) await this.mapController.view?.goTo?.(result.geometry); }));
  }

  #togglePresentationDock() {
    const dashboard = document.querySelector("#presentation-dashboard");
    if (!dashboard) return;
    this.utilityPresentationOpen = !this.utilityPresentationOpen;
    if (this.utilityPresentationOpen) {
      document.querySelector("#utility-presentation-content")?.append(dashboard);
      document.body.classList.add("presentation-workspace-panels-open");
      document.querySelectorAll(".sidebar__scroll > .panel[data-presentation-hidden]").forEach((panel) => { panel.hidden = false; });
    } else {
      document.querySelector(".sidebar__scroll")?.prepend(dashboard);
      document.body.classList.remove("presentation-workspace-panels-open");
      document.querySelectorAll(".sidebar__scroll > .panel[data-presentation-hidden]").forEach((panel) => { panel.hidden = true; });
    }
    this.#syncUtilityPanel("presentation");
    this.mapController.resize();
  }

  #addPresentationDockControl(root) {
    const header = root.querySelector(".mode-dashboard > header");
    if (!header || header.querySelector("[data-presentation-dock]")) return;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "presentation-dock-button";
    button.dataset.presentationDock = "";
    button.setAttribute("aria-label", this.utilityPresentationOpen ? "Return to left panel" : "Open in right panel");
    button.title = button.getAttribute("aria-label");
    button.textContent = this.utilityPresentationOpen ? "↙" : "↗";
    button.addEventListener("click", () => this.#togglePresentationDock());
    header.append(button);
  }

  #fieldOptions(fields, selected, predicate = () => true) {
    return fields.filter(predicate).map((field) => `<option value="${escapeHtml(field.name)}"${field.name === selected ? " selected" : ""}>${escapeHtml(field.alias || field.name)}</option>`).join("");
  }

  #searchOperatorOptions(field) {
    const kind = fieldKind(field);
    const options = kind === "number"
      ? [["equals", "Equals"], ["gt", "Greater than"], ["lt", "Less than"], ["missing", "Is missing"]]
      : [["contains", "Contains"], ["equals", "Equals"], ["starts", "Starts with"], ["missing", "Is missing"]];
    return options.map(([value, label]) => `<option value="${value}"${this.presentationState.searchOperator === value ? " selected" : ""}>${label}</option>`).join("");
  }

  #renderExplorerWorkspace(root, presentation, layer, fields) {
    const state = this.presentationState;
    const roles = state.roles || this.#presentationRoles(presentation, layer, fields);
    const loaded = state.records.length;
    const total = state.totalCount;
    const incomplete = Number.isFinite(total) && total > loaded;
    const selected = state.selected;
    const idField = layer.objectIdField;
    const chart = histogram(state.visibleRecords, state.chartField, state.binCount);
    const maxBin = Math.max(1, ...chart.bins.map((bin) => bin.count));
    const pageCount = Math.max(1, Math.ceil(state.visibleRecords.length / state.pageSize));
    state.page = Math.min(state.page, pageCount);
    const pageRecords = state.visibleRecords.slice((state.page - 1) * state.pageSize, state.page * state.pageSize);
    const searchField = fields.fields.find((field) => field.name === state.searchField);
    const chartLabel = fields.fields.find((field) => field.name === state.chartField)?.alias || state.chartField || "Numeric field";
    const activeRange = state.rangeMin != null || state.rangeMax != null;
    root.innerHTML = `<section class="mode-dashboard mode-dashboard--explorer presentation-workspace">
      <header class="presentation-compact-header"><span class="eyebrow">Dataset explorer</span><h2>${escapeHtml(presentation.title || layer.title || "Explore records")}</h2><label class="compact-dataset"><span>Dataset</span><select data-mode-dataset>${this.mapController.getOperationalLayers().filter((item) => typeof item.queryFeatures === "function").map((item) => `<option value="${escapeHtml(item.uid)}"${item.uid === layer.uid ? " selected" : ""}>${escapeHtml(item.title || "Untitled layer")}</option>`).join("")}</select></label></header>
      <div class="explorer-counts"><button data-coverage-open><b>${Number.isFinite(total) ? total.toLocaleString() : "—"}</b><span>Total${Number.isFinite(total) ? "" : " unknown"}</span></button><button data-coverage-open><b>${loaded.toLocaleString()}</b><span>Available locally</span></button><button data-mode-zoom><b>${state.visibleRecords.length.toLocaleString()}</b><span>Match filters</span></button><button data-selection-zoom><b>${state.selectedIds.size}</b><span>Selected</span></button></div>
      <p class="explorer-coverage ${incomplete ? "is-partial" : ""}">${incomplete ? `Working with ${loaded.toLocaleString()} locally available records out of ${total.toLocaleString()} reported by the service.` : `Working with ${loaded.toLocaleString()} records available to this browser.`}</p>
      <section class="explorer-toolbar"><div class="explorer-search-grid"><label class="field"><span>Search field</span><select data-search-field><option value="*"${state.searchField === "*" ? " selected" : ""}>All searchable text fields</option>${this.#fieldOptions(fields.fields, state.searchField)}</select></label><label class="field"><span>Match</span><select data-search-operator>${this.#searchOperatorOptions(searchField)}</select></label><label class="field explorer-search-input"><span>Search records</span><input data-mode-search list="presentation-search-values" value="${escapeHtml(state.search)}" placeholder="Search ${escapeHtml(searchField?.alias || "text fields")}" /><datalist id="presentation-search-values">${state.searchField && state.searchField !== "*" ? [...new Set(state.records.map((record) => record.attributes?.[state.searchField]).filter((value) => value != null && value !== "").map(String))].slice(0, 60).map((value) => `<option value="${escapeHtml(value)}"></option>`).join("") : ""}</datalist></label></div>
      <label class="scope-toggle"><input type="checkbox" data-mode-extent${state.scope === "extent" ? " checked" : ""}/> Limit to current map extent</label>
      <div class="filter-chips">${state.search ? `<button data-clear-search>${escapeHtml(searchField?.alias || "All text")}: ${escapeHtml(state.search)} ×</button>` : ""}${activeRange ? `<button data-clear-range>${escapeHtml(chartLabel)}: ${state.rangeMin ?? "−∞"}–${state.rangeMax ?? "+∞"} ×</button>` : ""}${state.scope === "extent" ? `<button data-clear-extent>Current extent ×</button>` : ""}${!state.search && !activeRange && state.scope !== "extent" ? "<span>No active filters</span>" : ""}</div><div class="explorer-actions"><button data-mode-zoom>Zoom to results</button><button class="button--quiet" data-mode-clear>Clear all</button></div></section>
      <section class="explorer-distribution"><div class="chart-controls"><label class="field"><span>Chart field</span><select data-chart-field>${this.#fieldOptions(fields.numeric, state.chartField)}</select></label><label class="field"><span>Bins</span><select data-chart-bins>${[8,12,16,24].map((count) => `<option${count === state.binCount ? " selected" : ""}>${count}</option>`).join("")}</select></label></div><strong>${escapeHtml(chartLabel)}</strong><div class="chart-axis"><span>${chart.min == null ? "No numeric values" : this.#formatExplorerNumber(chart.min)}</span><span>${chart.max == null ? "" : this.#formatExplorerNumber(chart.max)}</span></div><div class="explorer-histogram" style="grid-template-columns:repeat(${chart.bins.length || 1},1fr)" aria-label="Histogram of ${escapeHtml(chartLabel)}">${chart.bins.map((bin) => `<button data-range-bin-min="${bin.min}" data-range-bin-max="${bin.max}" title="${this.#formatExplorerNumber(bin.min)}–${this.#formatExplorerNumber(bin.max)}: ${bin.count}"><span style="height:${Math.max(3, bin.count / maxBin * 100)}%"></span></button>`).join("")}</div><p class="chart-caption">${chart.bins.length} bins · ${chart.missing} missing value${chart.missing === 1 ? "" : "s"}. Clicking a bin filters every view. <button type="button" class="link-button" data-style-chart>Style map by this field</button></p></section>
      <section class="explorer-results-table"><header><strong>Results</strong><span>${state.visibleRecords.length.toLocaleString()} local matches</span><label>Sort <select data-sort-field>${this.#fieldOptions(fields.fields, state.sortField)}</select></label><button data-sort-direction aria-label="Reverse sort">${state.sortDirection === "asc" ? "↑" : "↓"}</button></header><div class="results-table" role="table"><div class="results-row results-row--head" role="row"><span>Name</span><span>${escapeHtml(chartLabel)}</span><span>ID</span></div>${pageRecords.map((record) => { const id = featureId(record, idField); return `<button class="results-row${state.selectedIds.has(id) ? " is-selected" : ""}" data-mode-record-id="${escapeHtml(id)}"><span>${escapeHtml(this.#recordLabel(record, fields))}</span><span>${escapeHtml(this.#formatExplorerNumber(record.attributes?.[state.chartField]))}</span><span>${escapeHtml(id || "—")}</span></button>`; }).join("") || "<p class=\"form-note\">No locally available records match.</p>"}</div><footer><button data-page-prev${state.page <= 1 ? " disabled" : ""}>Previous</button><span>Page ${state.page} of ${pageCount}</span><button data-page-next${state.page >= pageCount ? " disabled" : ""}>Next</button></footer></section>
      <aside class="mode-details explorer-details"><span class="eyebrow">Selected record</span>${selected ? `<h3>${escapeHtml(this.#recordLabel(selected, fields))}</h3><div class="detail-actions"><button data-selection-zoom>Zoom</button><button data-filter-selected>Filter to selected</button><button data-selection-clear>Clear</button></div><dl>${Object.entries(selected.attributes || {}).filter(([, value]) => value != null && value !== "").slice(0, 8).map(([key, value]) => `<div><dt>${escapeHtml(fields.fields.find((field) => field.name === key)?.alias || key)}</dt><dd>${escapeHtml(formatAttributeValue(value, fields.fields.find((field) => field.name === key), key))}</dd></div>`).join("")}</dl><details><summary>All attributes</summary><dl>${Object.entries(selected.attributes || {}).map(([key,value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></details>` : "<p>Select a table row or mapped feature. Selection is independent from filtering.</p>"}</aside>
    </section>`;
    this.#addPresentationDockControl(root);
    this.#bindExplorerWorkspace(root, presentation, layer, fields);
  }

  #bindExplorerWorkspace(root, presentation, layer, fields) {
    const state = this.presentationState;
    const refresh = () => this.#filterPresentationRecords();
    root.querySelector("[data-mode-dataset]")?.addEventListener("change", (event) => {
      this.#loadPresentationRecords({ ...presentation, primaryLayerId: event.target.value });
    });
    root.querySelector("[data-search-field]")?.addEventListener("change", (event) => { state.searchField = event.target.value; state.searchOperator = "contains"; state.page = 1; refresh(); });
    root.querySelector("[data-search-operator]")?.addEventListener("change", (event) => { state.searchOperator = event.target.value; refresh(); });
    root.querySelector("[data-mode-search]")?.addEventListener("input", (event) => { state.search = event.target.value; state.page = 1; clearTimeout(this.presentationSearchTimer); this.presentationSearchTimer = setTimeout(refresh, 180); });
    root.querySelector("[data-mode-extent]")?.addEventListener("change", (event) => { state.scope = event.target.checked ? "extent" : "all"; state.page = 1; refresh(); });
    root.querySelector("[data-chart-field]")?.addEventListener("change", (event) => { state.chartField = event.target.value; state.rangeMin = null; state.rangeMax = null; refresh(); });
    root.querySelector("[data-chart-bins]")?.addEventListener("change", (event) => { state.binCount = Number(event.target.value); this.#renderExplorerWorkspace(root, presentation, layer, fields); });
    root.querySelector("[data-sort-field]")?.addEventListener("change", (event) => { state.sortField = event.target.value; state.page = 1; refresh(); });
    root.querySelector("[data-sort-direction]")?.addEventListener("click", () => { state.sortDirection = state.sortDirection === "asc" ? "desc" : "asc"; refresh(); });
    root.querySelectorAll("[data-range-bin-min]").forEach((button) => button.addEventListener("click", () => { state.rangeMin = Number(button.dataset.rangeBinMin); state.rangeMax = Number(button.dataset.rangeBinMax); state.page = 1; refresh(); }));
    root.querySelector("[data-clear-search]")?.addEventListener("click", () => { state.search = ""; refresh(); });
    root.querySelector("[data-clear-range]")?.addEventListener("click", () => { state.rangeMin = null; state.rangeMax = null; refresh(); });
    root.querySelector("[data-clear-extent]")?.addEventListener("click", () => { state.scope = "all"; refresh(); });
    root.querySelector("[data-mode-clear]")?.addEventListener("click", () => { Object.assign(state, { search: "", searchOperator: "contains", scope: "all", rangeMin: null, rangeMax: null, page: 1 }); refresh(); });
    root.querySelectorAll("[data-mode-zoom]").forEach((button) => button.addEventListener("click", async () => { const graphics = state.visibleRecords.map((record) => record.graphic).filter(Boolean); if (graphics.length) await this.mapController.view?.goTo?.(graphics, { padding: { left: 36, right: 360, bottom: 230 } }); }));
    root.querySelectorAll("[data-selection-zoom]").forEach((button) => button.addEventListener("click", async () => { if (state.selected?.geometry) await this.mapController.view?.goTo?.(state.selected.geometry, { padding: 100 }); }));
    root.querySelector("[data-selection-clear]")?.addEventListener("click", () => { state.selected = null; state.selectedIds.clear(); this.mapController.clearFeatureHighlight(); this.#renderExplorerWorkspace(root, presentation, layer, fields); });
    root.querySelector("[data-filter-selected]")?.addEventListener("click", () => { if (!state.selected) return; state.searchField = layer.objectIdField; state.searchOperator = "equals"; state.search = String(state.selected.attributes?.[layer.objectIdField] ?? ""); refresh(); });
    root.querySelector("[data-style-chart]")?.addEventListener("click", () => { const roles = { ...state.roles, metric: state.chartField }; const values = state.records.map((record) => Number(record.attributes?.[state.chartField])).filter(Number.isFinite); state.metricMin = values.length ? Math.min(...values) : null; state.metricMax = values.length ? Math.max(...values) : null; this.#applyExplorerMetricRenderer(layer, roles, presentation); this.toast(`Map styled by ${fields.fields.find((field) => field.name === state.chartField)?.alias || state.chartField}.`); });
    root.querySelector("[data-coverage-open]")?.addEventListener("click", () => this.openDialog({ eyebrow: "Dataset coverage", title: layer.title || "Coverage details", content: `<dl class="coverage-details"><div><dt>Service total</dt><dd>${Number.isFinite(state.totalCount) ? state.totalCount.toLocaleString() : "Not reported"}</dd></div><div><dt>Available locally</dt><dd>${state.records.length.toLocaleString()}</dd></div><div><dt>Completeness</dt><dd>${Number.isFinite(state.totalCount) ? `${Math.min(100, state.records.length / state.totalCount * 100).toFixed(1)}%` : "Unknown"}</dd></div><div><dt>Fetched</dt><dd>${escapeHtml(this.#formatExplorerTime(state.fetchedAt))}</dd></div><div><dt>Source</dt><dd>${escapeHtml(layer.url || "Local/project layer")}</dd></div></dl><p class="form-note">Search, charts, statistics, and the results table operate on records available locally. Refresh requests the source again; load-more support depends on the service.</p>`, actions: [{ label: "Close", handler: () => this.dialog.close() }, { label: "Refresh", primary: true, handler: () => { layer.refresh?.(); this.dialog.close(); this.#loadPresentationRecords(presentation); } }] }));
    root.querySelector("[data-page-prev]")?.addEventListener("click", () => { state.page -= 1; this.#renderExplorerWorkspace(root, presentation, layer, fields); });
    root.querySelector("[data-page-next]")?.addEventListener("click", () => { state.page += 1; this.#renderExplorerWorkspace(root, presentation, layer, fields); });
    root.querySelectorAll("[data-mode-record-id]").forEach((button) => button.addEventListener("click", async (event) => { const record = state.visibleRecords.find((item) => featureId(item, layer.objectIdField) === button.dataset.modeRecordId); if (!record) return; const id = featureId(record, layer.objectIdField); if (event.metaKey || event.ctrlKey || event.shiftKey) { state.selectedIds.has(id) ? state.selectedIds.delete(id) : state.selectedIds.add(id); state.selected = record; this.mapController.highlightFeature(record); this.#renderExplorerWorkspace(root, presentation, layer, fields); } else { this.#selectPresentationResult(record); if (record.geometry) await this.mapController.view?.goTo?.(record.geometry, { padding: { left: 36, right: 360, bottom: 140 } }); } }));
  }

  #renderBriefingWorkspace(root, presentation, layer, fields) {
    const state = this.presentationState;
    const selected = state.selected;
    const contextSettings = this.#briefingContextSettings(presentation);
    const contextSources = [layer, ...this.mapController.getOperationalLayers().filter((item) => item !== layer)]
      .filter((item) => !contextSettings.sourceIds.length || contextSettings.sourceIds.includes(item.uid));
    const nameField = state.roles?.title || fields.text[0]?.name;
    const idField = layer.objectIdField;
    const overview = selected ? Object.entries(selected.attributes || {}).filter(([key, value]) => value != null && value !== "" && key !== idField).slice(0, 5) : [];
    const section = (key, title, content) => contextSettings.sections[key] ? `<section><h4>${title}</h4>${content}</section>` : "";
    root.innerHTML = `<section class="mode-dashboard mode-dashboard--briefing presentation-workspace"><header class="presentation-compact-header"><span class="eyebrow">Context briefing</span><h2>${escapeHtml(presentation.title || layer.title || "Feature briefing")}</h2><label class="compact-dataset"><span>Dataset</span><select data-mode-dataset>${this.mapController.getOperationalLayers().filter((item) => typeof item.queryFeatures === "function").map((item) => `<option value="${escapeHtml(item.uid)}"${item.uid === layer.uid ? " selected" : ""}>${escapeHtml(item.title || "Untitled layer")}</option>`).join("")}</select></label></header><div class="briefing-search"><label class="field"><span>Search field</span><select data-search-field>${this.#fieldOptions(fields.fields, state.searchField)}</select></label><label class="field"><span>Find a feature</span><input data-mode-search value="${escapeHtml(state.search)}" placeholder="Search ${escapeHtml(fields.fields.find((field) => field.name === state.searchField)?.alias || nameField || "features")}"/></label><button data-mode-clear>Clear</button></div><div class="mode-records briefing-records">${state.visibleRecords.slice(0, 100).map((record) => `<button class="mode-record${record === selected ? " is-selected" : ""}" data-mode-record-id="${escapeHtml(featureId(record, idField))}"><strong>${escapeHtml(this.#recordLabel(record, fields))}</strong><small>${escapeHtml(featureId(record, idField) || "")}</small></button>`).join("") || "<p class=\"form-note\">No locally available features match.</p>"}</div><aside class="mode-details briefing-context"><button class="context-settings-button" data-briefing-settings aria-label="Context settings" title="Context settings">⚙</button><span class="eyebrow">${selected ? "Feature context" : "Select a feature"}</span>${selected ? `<h3>${escapeHtml(this.#recordLabel(selected, fields))}</h3><div class="detail-actions"><button data-selection-zoom aria-label="Zoom to feature" title="Zoom to feature">⌕</button><button data-selection-clear aria-label="Clear selected feature" title="Clear selected feature">×</button></div>${section("overview", "Overview", `<dl>${overview.map(([key,value]) => `<div><dt>${escapeHtml(fields.fields.find((field) => field.name === key)?.alias || key)}</dt><dd>${escapeHtml(formatAttributeValue(value, fields.fields.find((field) => field.name === key), key))}</dd></div>`).join("")}</dl>`)}${section("surroundings", "Surroundings", `<p data-briefing-surroundings>Checking visible contextual datasets…</p>`)}${section("ai", "AI context", `<p data-briefing-ai>${this.aiController.isConfigured() ? "Deterministic context appears first. Generate a concise explanation after reviewing it." : "AI is not configured. Spatial context and source details remain available."}</p>${this.aiController.isConfigured() ? "<button data-briefing-ai-run>Generate sourced context</button>" : ""}`)}${section("sources", "Sources", contextSources.map((source) => `<p>${escapeHtml(source.title || "Dataset")} ${source === layer ? `· retrieved ${escapeHtml(this.#formatExplorerTime(state.fetchedAt))}` : ""}</p>${source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">Open dataset source ↗</a>` : ""}`).join("") || "<p>No sources selected.</p>")}<details><summary>All attributes</summary><dl>${Object.entries(selected.attributes || {}).map(([key,value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl></details>` : "<p>Choose a named feature or click it on the map. The right context panel keeps selection, map highlight, and details synchronized.</p>"}</aside></section>`;
    if (selected) {
      const location = document.createElement("section");
      location.className = "briefing-location-details";
      location.innerHTML = `<span class="eyebrow">Location details</span><p data-briefing-address>Finding nearest address…</p>`;
      root.querySelector(".briefing-records")?.after(location);
      document.body.dataset.briefingContextDock = contextSettings.dock;
    }
    this.#addPresentationDockControl(root);
    this.#bindBriefingWorkspace(root, presentation, layer, fields);
    if (selected) void this.#loadBriefingContext(root, selected, layer);
  }

  #bindBriefingWorkspace(root, presentation, layer, fields) {
    const state = this.presentationState;
    const refresh = () => this.#filterPresentationRecords();
    root.querySelector("[data-mode-dataset]")?.addEventListener("change", (event) => this.#loadPresentationRecords({ ...presentation, primaryLayerId: event.target.value }));
    root.querySelector("[data-search-field]")?.addEventListener("change", (event) => { state.searchField = event.target.value; state.searchOperator = "contains"; refresh(); });
    root.querySelector("[data-mode-search]")?.addEventListener("input", (event) => { state.search = event.target.value; clearTimeout(this.presentationSearchTimer); this.presentationSearchTimer = setTimeout(refresh, 180); });
    root.querySelector("[data-mode-clear]")?.addEventListener("click", () => { state.search = ""; refresh(); });
    root.querySelectorAll("[data-mode-record-id]").forEach((button) => button.addEventListener("click", () => { const record = state.visibleRecords.find((item) => featureId(item, layer.objectIdField) === button.dataset.modeRecordId); this.#selectPresentationResult(record); }));
    root.querySelector("[data-selection-clear]")?.addEventListener("click", () => { this.briefingRequest.cancel(); state.selected = null; state.selectedIds.clear(); this.mapController.clearFeatureHighlight(); this.#renderBriefingWorkspace(root, presentation, layer, fields); });
    root.querySelectorAll("[data-mode-record-id]").forEach((button) => button.addEventListener("click", async () => { const record = state.visibleRecords.find((item) => featureId(item, layer.objectIdField) === button.dataset.modeRecordId); if (record?.geometry) await this.mapController.view?.goTo?.({ target: record.geometry, zoom: this.mapController.view?.zoom }, { animate: true }); }));
    root.querySelector("[data-selection-zoom]")?.addEventListener("click", async () => { if (state.selected?.geometry) await this.mapController.view?.goTo?.({ target: state.selected.geometry, zoom: Math.min(18, (this.mapController.view?.zoom || 10) + 2) }, { padding: { left: 80, right: 420 } }); });
    root.querySelector("[data-briefing-settings]")?.addEventListener("click", () => this.#briefingSettingsDialog(presentation, layer));
    root.querySelector("[data-briefing-ai-run]")?.addEventListener("click", () => {
      if (!state.selected || !this.aiController.isConfigured()) return;
      const context = root.querySelector("[data-briefing-surroundings]")?.textContent || "No surrounding results available.";
      this.#openIntelligenceUtility();
      this.#askAI(`Explain this selected feature concisely using only its supplied attributes and the deterministic spatial context. Distinguish nearby or intersecting features from verified impacts. Cite dataset names in the response. Spatial context: ${context}`, { selectedResults: [state.selected] }, "Briefing context");
    });
  }

  #briefingContextSettings(presentation = {}) {
    const stored = presentation.contextSettings || {};
    return {
      dock: ["floating", "left", "right", "top", "bottom"].includes(stored.dock) ? stored.dock : "floating",
      perimeter: Math.max(0, Number(stored.perimeter) || 10),
      units: stored.units === "miles" ? "miles" : "kilometers",
      sections: { overview: true, surroundings: true, ai: true, sources: true, ...(stored.sections || {}) },
      layerIds: Array.isArray(stored.layerIds) ? stored.layerIds : [],
      sourceIds: Array.isArray(stored.sourceIds) ? stored.sourceIds : [],
    };
  }

  #briefingSettingsDialog(presentation, primaryLayer) {
    const settings = this.#briefingContextSettings(presentation);
    const layers = this.mapController.getOperationalLayers().filter((layer) => layer !== primaryLayer);
    const check = (value) => value ? " checked" : "";
    this.openDialog({
      eyebrow: "Context briefing",
      title: "Context settings",
      content: `<div class="briefing-settings"><fieldset><legend>Visible sections</legend>${[["overview", "Overview"], ["surroundings", "Surroundings"], ["ai", "AI context"], ["sources", "Sources"]].map(([key, label]) => `<label><input type="checkbox" data-context-section="${key}"${check(settings.sections[key])}/> ${label}</label>`).join("")}</fieldset><label class="field"><span>Presentation</span><select data-context-dock><option value="floating"${settings.dock === "floating" ? " selected" : ""}>Floating over map</option><option value="left"${settings.dock === "left" ? " selected" : ""}>Dock left</option><option value="right"${settings.dock === "right" ? " selected" : ""}>Dock right</option><option value="top"${settings.dock === "top" ? " selected" : ""}>Dock top</option><option value="bottom"${settings.dock === "bottom" ? " selected" : ""}>Dock bottom</option></select></label><fieldset><legend>Surroundings</legend><label class="field"><span>Search perimeter</span><input data-context-perimeter type="number" min="0" value="${settings.perimeter}" /></label><label class="field"><span>Units</span><select data-context-units><option${settings.units === "kilometers" ? " selected" : ""}>kilometers</option><option${settings.units === "miles" ? " selected" : ""}>miles</option></select></label><p class="form-note">Choose the visible layers checked for contextual intersections.</p>${layers.map((layer) => `<label><input type="checkbox" data-context-layer="${escapeHtml(layer.uid)}"${check(!settings.layerIds.length || settings.layerIds.includes(layer.uid))}/> ${escapeHtml(layer.title || "Untitled layer")}</label>`).join("") || "<p class=\"form-note\">No additional map layers are available.</p>"}</fieldset><fieldset><legend>Sources</legend><p class="form-note">Select sources that may be presented alongside the primary dataset or supplied to AI context.</p>${[primaryLayer, ...layers].map((layer) => `<label><input type="checkbox" data-context-source="${escapeHtml(layer.uid)}"${check(!settings.sourceIds.length || settings.sourceIds.includes(layer.uid))}/> ${escapeHtml(layer.title || "Untitled layer")}</label>`).join("")}</fieldset><p class="form-note">AI uses the shared application-wide intelligence provider. Configure it once and it is reused here.</p></div>`,
      actions: [
        { label: "Configure AI…", handler: () => this.#aiDialog() },
        { label: "Cancel", handler: () => this.dialog.close() },
        { label: "Save", primary: true, handler: () => {
          const next = {
            dock: this.dialog.querySelector("[data-context-dock]").value,
            perimeter: Number(this.dialog.querySelector("[data-context-perimeter]").value) || 10,
            units: this.dialog.querySelector("[data-context-units]").value,
            sections: Object.fromEntries([...this.dialog.querySelectorAll("[data-context-section]")].map((input) => [input.dataset.contextSection, input.checked])),
            layerIds: [...this.dialog.querySelectorAll("[data-context-layer]:checked")].map((input) => input.dataset.contextLayer),
            sourceIds: [...this.dialog.querySelectorAll("[data-context-source]:checked")].map((input) => input.dataset.contextSource),
          };
          const updated = this.projectManager.setPresentation({ ...this.projectManager.current.presentation, contextSettings: next });
          document.body.dataset.briefingContextDock = next.dock;
          this.dialog.close();
          this.#renderPresentationDashboard(updated);
          this.mapController.resize();
        } },
      ],
    });
  }

  async #loadBriefingContext(root, selected, primaryLayer) {
    const token = this.briefingRequest.next();
    const output = root.querySelector("[data-briefing-surroundings]");
    if (!output) return;
    const addressOutput = root.querySelector("[data-briefing-address]");
    if (selected.geometry?.type === "point") {
      void this.mapController.reverseGeocode(selected.geometry).then((result) => {
        if (this.briefingRequest.valid(token) && this.presentationState.selected === selected && addressOutput?.isConnected) {
          addressOutput.textContent = result?.address ? `Nearest address: ${result.address}` : "Nearest address: not available for this feature.";
        }
      }).catch(() => { if (addressOutput?.isConnected) addressOutput.textContent = "Nearest address: not available for this feature."; });
    } else if (addressOutput) {
      addressOutput.textContent = "Location details are available for point features.";
    }
    const settings = this.#briefingContextSettings(this.projectManager.current.presentation);
    const contextual = this.mapController.getOperationalLayers().filter((layer) => layer !== primaryLayer && layer.visible && typeof layer.queryFeatureCount === "function" && (!settings.layerIds.length || settings.layerIds.includes(layer.uid)));
    if (!contextual.length) { output.textContent = "No other visible queryable datasets are available. Add or show a contextual layer to inspect surroundings."; return; }
    const results = await Promise.all(contextual.map(async (layer) => {
      try {
        const query = layer.createQuery?.() || {};
        Object.assign(query, { geometry: selected.geometry, spatialRelationship: "intersects", distance: settings.perimeter, units: settings.units, where: layer.definitionExpression || "1=1" });
        return { title: layer.title || "Untitled layer", count: await layer.queryFeatureCount(query), status: "intersecting" };
      } catch { return { title: layer.title || "Untitled layer", count: null, status: "unavailable" }; }
    }));
    if (!this.briefingRequest.valid(token) || this.presentationState.selected !== selected || !output.isConnected) return;
    output.innerHTML = results.map((result) => result.count == null ? `<span>${escapeHtml(result.title)}: unavailable</span>` : `<button type="button" class="context-fact"><b>${result.count}</b> ${escapeHtml(result.title)} feature${result.count === 1 ? "" : "s"} intersect the selected geometry</button>`).join("") || "No intersections found.";
  }

  #saveAtlasChapters(chapters) {
    const presentation = this.projectManager.setPresentation({ ...this.projectManager.current.presentation, chapters });
    this.#renderPresentationDashboard(presentation);
  }

  async #captureAtlasChapter() {
    const view = this.mapController.view;
    if (!view) return;
    const chapters = this.projectManager.current.presentation?.chapters || [];
    const address = await this.mapController.reverseGeocode(view.center);
    const next = [...chapters, {
      id: crypto.randomUUID?.() || `chapter-${Date.now()}`,
      title: `Chapter ${chapters.length + 1}`,
      body: "",
      mediaUrl: "",
      reverseAddress: address?.address || "",
      viewState: this.mapController.getViewState(),
      viewpoint: view.viewpoint?.toJSON?.() || null,
      basemapId: this.mapController.getBasemapId(),
      lingerSeconds: 4,
      visibleLayerIds: this.mapController.getOperationalLayers().filter((layer) => layer.visible).map((layer) => layer.uid),
      layerVisibility: this.mapController.getOperationalLayers().map((layer) => ({ key: this.#atlasLayerKey(layer), visible: layer.visible })),
    }];
    this.#saveAtlasChapters(next);
    this.#editAtlasChapter(next, next.length - 1);
  }

  #atlasLayerKey(layer) {
    const config = this.mapController.getLayerConfig(layer) || {};
    if (config.projectPath) return `local:${config.projectPath}`;
    if (config.url) return `url:${String(config.url).replace(/\/$/, "").toLowerCase()}`;
    return `title:${String(layer?.title || "untitled").toLowerCase()}`;
  }

  #atlasGeographicCameraPosition(position = {}) {
    const wkid = position.spatialReference?.latestWkid ?? position.spatialReference?.wkid;
    if (![3857, 102100, 102113].includes(wkid)) return { longitude: position.x ?? position.longitude, latitude: position.y ?? position.latitude, altitude: position.z };
    const radius = 6378137;
    return {
      longitude: (position.x / radius) * (180 / Math.PI),
      latitude: (2 * Math.atan(Math.exp(position.y / radius)) - (Math.PI / 2)) * (180 / Math.PI),
      altitude: position.z,
    };
  }

  #atlasEditorViewState() {
    const state = structuredClone(this.atlasEditingViewState || this.mapController.getViewState());
    const camera = state.camera || {};
    const position = camera.position || {};
    const geographic = this.#atlasGeographicCameraPosition(position);
    const number = (selector, fallback) => {
      const value = Number(this.dialog.querySelector(selector)?.value);
      return Number.isFinite(value) ? value : fallback;
    };
    camera.position = {
      ...position,
      x: number("#atlas-camera-longitude", geographic.longitude),
      y: number("#atlas-camera-latitude", geographic.latitude),
      z: number("#atlas-camera-altitude", geographic.altitude ?? 0),
      spatialReference: { wkid: 4326 },
    };
    camera.heading = number("#atlas-camera-heading", camera.heading ?? state.heading ?? 0);
    camera.tilt = number("#atlas-camera-tilt", camera.tilt ?? state.tilt ?? 0);
    state.camera = camera;
    state.heading = camera.heading;
    state.tilt = camera.tilt;
    return state;
  }

  async #syncAtlasEditorToCurrentView(addressLabel = "") {
    if (!this.dialog.open) return;
    const state = this.mapController.getViewState();
    this.atlasEditingViewState = structuredClone(state);
    const position = state.camera?.position || {};
    const geographic = this.#atlasGeographicCameraPosition(position);
    const setValue = (selector, value, digits = 5) => {
      const input = this.dialog.querySelector(selector);
      if (input && Number.isFinite(Number(value))) input.value = Number(value).toFixed(digits);
    };
    setValue("#atlas-camera-longitude", geographic.longitude, 6);
    setValue("#atlas-camera-latitude", geographic.latitude, 6);
    setValue("#atlas-camera-altitude", geographic.altitude, 1);
    setValue("#atlas-camera-heading", state.camera?.heading ?? state.heading, 1);
    setValue("#atlas-camera-tilt", state.camera?.tilt ?? state.tilt, 1);
    const addressOutput = this.dialog.querySelector("#atlas-reverse-address");
    if (!addressOutput) return;
    addressOutput.textContent = addressLabel || "Finding the place at the center of this view…";
    const address = addressLabel ? { address: addressLabel } : await this.mapController.reverseGeocode(this.mapController.view?.center);
    if (!this.dialog.open || !this.dialog.querySelector("#atlas-reverse-address")) return;
    addressOutput.textContent = address?.address || "No street address was found for this view.";
    addressOutput.dataset.address = address?.address || "";
  }

  async #editAtlasChapter(chapters, index) {
    const chapter = chapters[index];
    if (!chapter) return;
    this.atlasEditingViewState = structuredClone(chapter.viewState || this.mapController.getViewState());
    const position = this.atlasEditingViewState.camera?.position || {};
    const geographicPosition = this.#atlasGeographicCameraPosition(position);
    const basemapOptions = BASEMAP_OPTIONS.map(([id, label]) => `<option value="${id}"${(chapter.basemapId || this.mapController.getBasemapId()) === id ? " selected" : ""}>${escapeHtml(label)}</option>`).join("");
    const visibility = new Map((chapter.layerVisibility || []).map((entry) => [entry.key, entry.visible !== false]));
    const layerChoices = this.mapController.getOperationalLayers().map((layer) => {
      const key = this.#atlasLayerKey(layer);
      const checked = visibility.has(key) ? visibility.get(key) : chapter.visibleLayerIds ? chapter.visibleLayerIds.includes(layer.uid) : layer.visible;
      return `<label class="atlas-layer-choice"><input type="checkbox" data-atlas-layer-key="${escapeHtml(key)}"${checked ? " checked" : ""} /><span>${escapeHtml(layer.title || "Untitled layer")}</span></label>`;
    }).join("") || `<p class="form-note">This project has no operational layers. The basemap and camera will still be saved.</p>`;
    this.openDialog({
      eyebrow: "Atlas chapter",
      title: "Edit chapter",
      content: `<label class="field"><span>Title</span><input id="atlas-editor-title" value="${escapeHtml(chapter.title || "")}" /></label><label class="field"><span>Description <small>Shown in the lower-right card during the tour</small></span><textarea id="atlas-chapter-body" rows="4">${escapeHtml(chapter.body || "")}</textarea></label><label class="field"><span>Image URL <small>Optional public http(s) image</small></span><input id="atlas-chapter-media" type="url" inputmode="url" placeholder="https://example.com/photo.jpg" value="${escapeHtml(chapter.mediaUrl || "")}" /></label><section class="atlas-geocoder"><label class="field"><span>Zoom to a place or address</span><div class="atlas-geocoder__search"><input id="atlas-place-query" type="search" placeholder="Address, place, or longitude, latitude" /><button id="atlas-place-search" type="button">Find</button></div></label><div id="atlas-place-results" class="atlas-place-results" hidden></div><div class="atlas-reverse-place"><span>Center of view</span><output id="atlas-reverse-address" data-address="${escapeHtml(chapter.reverseAddress || "")}">${escapeHtml(chapter.reverseAddress || "Finding address…")}</output><button id="atlas-use-current-view" type="button">Use current map view</button></div></section><fieldset class="atlas-camera-fields"><legend>Exact camera</legend><label>Longitude<input id="atlas-camera-longitude" type="number" step="0.000001" value="${escapeHtml(geographicPosition.longitude ?? "")}" /></label><label>Latitude<input id="atlas-camera-latitude" type="number" step="0.000001" value="${escapeHtml(geographicPosition.latitude ?? "")}" /></label><label>Altitude (m)<input id="atlas-camera-altitude" type="number" step="0.1" value="${escapeHtml(geographicPosition.altitude ?? "")}" /></label><label>Heading / angle<input id="atlas-camera-heading" type="number" min="0" max="360" step="0.1" value="${escapeHtml(this.atlasEditingViewState.camera?.heading ?? this.atlasEditingViewState.heading ?? 0)}" /></label><label>Tilt<input id="atlas-camera-tilt" type="number" min="0" max="179" step="0.1" value="${escapeHtml(this.atlasEditingViewState.camera?.tilt ?? this.atlasEditingViewState.tilt ?? 0)}" /></label></fieldset><div class="field-grid"><label class="field"><span>Basemap</span><select id="atlas-chapter-basemap">${basemapOptions}</select></label><label class="field"><span>Linger (seconds) <small>Auto playback only</small></span><input id="atlas-chapter-linger" type="number" min="1" max="120" step="1" value="${Number(chapter.lingerSeconds) || 4}" /></label></div><fieldset class="atlas-layer-fields"><legend>Layers in this chapter</legend>${layerChoices}</fieldset>`,
      actions: [{ label: "Save", primary: true, handler: () => {
        const mediaUrl = this.dialog.querySelector("#atlas-chapter-media").value.trim();
        if (mediaUrl && !/^https?:\/\//i.test(mediaUrl)) return this.error("Use a full http or https image URL.");
        const lingerSeconds = Math.min(120, Math.max(1, Number(this.dialog.querySelector("#atlas-chapter-linger").value) || 4));
        const layerVisibility = [...this.dialog.querySelectorAll("[data-atlas-layer-key]")].map((input) => ({ key: input.dataset.atlasLayerKey, visible: input.checked }));
        const next = chapters.map((item, itemIndex) => itemIndex === index ? {
          ...item,
          title: this.dialog.querySelector("#atlas-editor-title").value.trim() || `Chapter ${index + 1}`,
          body: this.dialog.querySelector("#atlas-chapter-body").value.trim(),
          mediaUrl,
          reverseAddress: this.dialog.querySelector("#atlas-reverse-address").dataset.address || "",
          viewState: this.#atlasEditorViewState(),
          viewpoint: null,
          basemapId: this.dialog.querySelector("#atlas-chapter-basemap").value,
          lingerSeconds,
          layerVisibility,
          visibleLayerIds: undefined,
        } : item);
        this.#saveAtlasChapters(next);
        this.dialog.close();
      } }],
    });
    this.dialog.querySelector("#atlas-use-current-view").addEventListener("click", () => this.#syncAtlasEditorToCurrentView());
    const runSearch = async () => {
      const query = this.dialog.querySelector("#atlas-place-query").value.trim();
      const resultsElement = this.dialog.querySelector("#atlas-place-results");
      if (!query) return;
      resultsElement.hidden = false;
      resultsElement.innerHTML = `<div class="loading-row"><span></span> Searching…</div>`;
      try {
        const results = await this.mapController.searchPlaces(query);
        resultsElement.innerHTML = results.length ? results.map((result, resultIndex) => `<button type="button" data-atlas-place-result="${resultIndex}">${escapeHtml(result.label)}</button>`).join("") : `<p>No matching places found.</p>`;
        resultsElement.querySelectorAll("[data-atlas-place-result]").forEach((button) => button.addEventListener("click", async () => {
          const result = results[Number(button.dataset.atlasPlaceResult)];
          await this.mapController.goToSearchResult(result);
          resultsElement.hidden = true;
          await this.#syncAtlasEditorToCurrentView(result.label);
        }));
      } catch (error) {
        resultsElement.innerHTML = `<p>${escapeHtml(error.message)}</p>`;
      }
    };
    this.dialog.querySelector("#atlas-place-search").addEventListener("click", runSearch);
    this.dialog.querySelector("#atlas-place-query").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); void runSearch(); } });
    if (!chapter.reverseAddress) void this.#syncAtlasEditorToCurrentView();
  }

  async #goToAtlasChapter(chapter, index = null, chapters = this.projectManager.current.presentation?.chapters || []) {
    if (!chapter) return;
    // Update the story immediately.  A SceneView navigation can take longer
    // than the chapter linger (or never resolve after an interrupted camera
    // transition), but it must not hold the player hostage.
    const chapterIndex = Number.isInteger(index) ? index : chapters.indexOf(chapter);
    this.#showAtlasChapterOverlay(chapter, chapterIndex, chapters);
    if (chapter.basemapId && BASEMAP_IDS.has(chapter.basemapId)) this.mapController.setBasemap(chapter.basemapId);
    const visibility = new Map((chapter.layerVisibility || []).map((entry) => [entry.key, entry.visible !== false]));
    this.mapController.getOperationalLayers().forEach((layer) => {
      if (visibility.size) layer.visible = visibility.get(this.#atlasLayerKey(layer)) ?? layer.visible;
      else if (chapter.visibleLayerIds) layer.visible = chapter.visibleLayerIds.includes(layer.uid);
    });
    const animate = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const state = chapter.viewState;
    if (state?.camera) await this.mapController.view?.goTo?.(state.camera, { animate });
    else if (state?.center) await this.mapController.view?.goTo?.({ center: state.center, zoom: state.zoom, heading: state.heading ?? 0, tilt: state.tilt ?? 0 }, { animate });
    else if (chapter.viewpoint) await this.mapController.view?.goTo?.(chapter.viewpoint, { animate });
  }

  #showAtlasChapterOverlay(chapter, index, chapters) {
    const overlay = document.querySelector("#atlas-chapter-overlay");
    if (!overlay || !chapter || index < 0) return;
    this.presentationState.atlasChapterIndex = index;
    document.querySelector("#atlas-chapter-position").textContent = `Chapter ${index + 1} of ${chapters.length}`;
    document.querySelector("#atlas-chapter-title").textContent = chapter.title || `Chapter ${index + 1}`;
    const message = document.querySelector("#atlas-chapter-message");
    message.textContent = chapter.body || "";
    const description = document.querySelector("#atlas-chapter-description");
    const image = document.querySelector("#atlas-chapter-image");
    const hasImage = /^https?:\/\//i.test(chapter.mediaUrl || "");
    image.hidden = !hasImage;
    image.src = hasImage ? chapter.mediaUrl : "";
    image.alt = hasImage ? `${chapter.title || `Chapter ${index + 1}`} illustration` : "";
    image.onerror = () => { image.hidden = true; };
    message.hidden = !chapter.body;
    description.hidden = !chapter.body && !hasImage;
    document.querySelector("#atlas-chapter-previous").disabled = index <= 0;
    document.querySelector("#atlas-chapter-next").disabled = index >= chapters.length - 1;
    const play = document.querySelector("#atlas-chapter-play");
    const auto = this.projectManager.current.presentation?.playbackMode !== "manual";
    play.hidden = !auto;
    play.setAttribute("aria-label", this.presentationState.atlasPlaying ? "Stop tour" : "Play tour");
    play.innerHTML = this.presentationState.atlasPlaying ? "■ <span>Stop</span>" : "▶ <span>Play</span>";
    overlay.hidden = false;
  }

  #hideAtlasChapterOverlay() {
    const overlay = document.querySelector("#atlas-chapter-overlay");
    if (overlay) overlay.hidden = true;
    const description = document.querySelector("#atlas-chapter-description");
    if (description) description.hidden = true;
    this.presentationState.atlasChapterIndex = null;
  }

  async #stepAtlasChapter(direction) {
    const chapters = this.projectManager.current.presentation?.chapters || [];
    if (!chapters.length) return;
    this.#stopAtlasStory();
    const current = Number.isInteger(this.presentationState.atlasChapterIndex) ? this.presentationState.atlasChapterIndex : 0;
    const index = Math.max(0, Math.min(chapters.length - 1, current + direction));
    await this.#goToAtlasChapter(chapters[index], index, chapters);
  }

  #basemapLabel(id) {
    return BASEMAP_OPTIONS.find(([value]) => value === id)?.[1] || id;
  }

  #stopAtlasStory() {
    this.atlasPlaybackToken += 1;
    clearTimeout(this.atlasPlaybackTimer);
    this.atlasPlaybackTimer = null;
    this.presentationState.atlasPlaying = false;
    this.#renderPresentationDashboard(this.projectManager.current.presentation || {});
    const play = document.querySelector("#atlas-chapter-play");
    if (play) { play.setAttribute("aria-label", "Play tour"); play.innerHTML = "▶ <span>Play</span>"; }
  }

  #toggleAtlasPlayback() {
    const presentation = this.projectManager.current.presentation || {};
    const chapters = presentation.chapters || [];
    if (!chapters.length || presentation.playbackMode === "manual") return;
    if (this.presentationState.atlasPlaying) return this.#stopAtlasStory();
    const startIndex = Number.isInteger(this.presentationState.atlasChapterIndex) ? this.presentationState.atlasChapterIndex : 0;
    this.#playAtlasStory(chapters, startIndex);
    const play = document.querySelector("#atlas-chapter-play");
    if (play) { play.setAttribute("aria-label", "Stop tour"); play.innerHTML = "■ <span>Stop</span>"; }
  }

  #playAtlasStory(chapters, startIndex = 0) {
    if (!chapters.length) return;
    const token = ++this.atlasPlaybackToken;
    this.presentationState.atlasPlaying = true;
    this.#renderPresentationDashboard(this.projectManager.current.presentation || {});
    const advance = (index) => {
      if (token !== this.atlasPlaybackToken) return;
      const chapter = chapters[index];
      if (!chapter) return this.#stopAtlasStory();
      // Camera motion is deliberately non-blocking: a slow or interrupted
      // SceneView animation must never prevent the saved linger timer from
      // moving the story on to the next chapter.
      void this.#goToAtlasChapter(chapter, index, chapters).catch(() => {});
      const linger = Math.min(120, Math.max(1, Number(chapter.lingerSeconds) || 4)) * 1000;
      this.atlasPlaybackTimer = setTimeout(() => {
        if (token !== this.atlasPlaybackToken) return;
        if (index >= chapters.length - 1) this.#stopAtlasStory();
        else advance(index + 1);
      }, linger);
    };
    advance(Math.max(0, Math.min(chapters.length - 1, startIndex)));
  }

  #applyPresentation(presentation = {}) {
    const app = document.querySelector("#app");
    const template = presentation.template || "standard";
    app.dataset.presentation = template;
    app.dataset.presentationSkin = presentation.skin || "clean-light";
    document.body.dataset.presentation = template;
    document.querySelector("#presentation-status")?.remove();
    const welcomePanel = document.querySelector("#welcome-panel");
    let context = document.querySelector("#presentation-context");
    let dashboard = document.querySelector("#presentation-dashboard");
    if (!dashboard) {
      dashboard = document.createElement("section");
      dashboard.id = "presentation-dashboard";
      dashboard.hidden = true;
      document.querySelector(".sidebar__scroll")?.prepend(dashboard);
    }
    document.querySelectorAll(".sidebar__scroll > .panel[data-presentation-hidden]").forEach((panel) => {
      panel.hidden = false;
      delete panel.dataset.presentationHidden;
    });
    if (template === "standard") {
      clearTimeout(this.presentationSearchTimer);
      context?.remove();
      dashboard.replaceChildren();
      dashboard.hidden = true;
      this.presentationState = { template: "standard", records: [], visibleRecords: [], selected: null, layerUid: null, search: "", category: "" };
      this.mapController.clearFeatureHighlight();
      this.#hideAtlasChapterOverlay();
      if (welcomePanel) welcomePanel.hidden = welcomePanel.dataset.dismissed === "true";
      return;
    }
    if (welcomePanel) welcomePanel.hidden = true;
    if (this.mobileMedia.matches) this.#setSidebarCollapsed(false);
    if (template !== "atlas") this.#hideAtlasChapterOverlay();
    this.presentationState.template = template;
    context?.remove();
    document.querySelectorAll(".sidebar__scroll > .panel").forEach((panel) => {
      panel.dataset.presentationHidden = "true";
      panel.hidden = true;
    });
    this.#loadPresentationRecords(presentation);
  }

  #applicationBuilderDialog() {
    const previous = this.projectManager.current.application?.configured
      ? structuredClone(this.projectManager.current.application)
      : null;
    let draft = normalizeApplicationConfig(previous || presetApplication("standard"));
    let previewing = false;
    let builderFinished = false;
    const panelTypes = this.applicationRuntime.panels.list();
    const layers = this.mapController.getOperationalLayers();
    const presetLabels = { standard: "Standard workspace", explorer: "Explorer", briefing: "Briefing", atlas: "Atlas", "ai-map": "AI Map" };
    const render = () => {
      const root = this.dialog.querySelector("[data-application-builder]");
      if (!root) return;
      const panelRows = draft.panels.map((panel) => {
        const panelIndex = draft.panels.indexOf(panel);
        const boundLayer = this.mapController.findLayer(panel.binding?.layerId) || layers[0];
        const fields = boundLayer?.fields || [];
        const fieldControl = ["charts", "attributes"].includes(panel.type) && fields.length
          ? `<select data-builder-field aria-label="Field configuration"><option value="">Automatic field</option>${fields.map((field) => `<option value="${escapeHtml(field.name)}"${panel.settings?.field === field.name ? " selected" : ""}>${escapeHtml(field.alias || field.name)}</option>`).join("")}</select>`
          : "";
        return `<div class="application-builder__instance" data-builder-instance="${escapeHtml(panel.instanceId)}"><input data-builder-panel-title aria-label="Panel title" value="${escapeHtml(panel.title)}" /><select data-builder-region aria-label="Panel placement">${["left", "right", "bottom", "floating"].map((region) => `<option value="${region}"${panel.placement.region === region ? " selected" : ""}>${region[0].toUpperCase()}${region.slice(1)} dock</option>`).join("")}</select><select data-builder-layer aria-label="Dataset binding"><option value="">Follow active layer</option>${layers.map((layer) => `<option value="${escapeHtml(layer.uid)}"${panel.binding?.layerId === layer.uid ? " selected" : ""}>${escapeHtml(layer.title || "Untitled layer")}</option>`).join("")}</select>${fieldControl}<label><input data-builder-audience type="checkbox"${panel.audienceVisible ? " checked" : ""} /> Audience</label><span class="application-builder__order"><button type="button" class="button--quiet" data-builder-up aria-label="Move ${escapeHtml(panel.title)} earlier"${panelIndex === 0 ? " disabled" : ""}>↑</button><button type="button" class="button--quiet" data-builder-down aria-label="Move ${escapeHtml(panel.title)} later"${panelIndex === draft.panels.length - 1 ? " disabled" : ""}>↓</button></span><button type="button" class="button--quiet" data-builder-remove aria-label="Remove ${escapeHtml(panel.title)}">Remove</button></div>`;
      }).join("");
      root.innerHTML = `<div class="application-builder__top"><label class="field"><span>Starting preset</span><select data-builder-preset>${Object.entries(presetLabels).map(([id, label]) => `<option value="${id}"${draft.preset === id ? " selected" : ""}>${label}</option>`).join("")}</select></label><label class="field"><span>Skin</span><select data-builder-skin><option value="clean-light"${draft.skin === "clean-light" ? " selected" : ""}>Clean Light</option><option value="dark-analytical"${draft.skin === "dark-analytical" ? " selected" : ""}>Dark Analytical</option><option value="retro-print"${draft.skin === "retro-print" ? " selected" : ""}>Retro Print</option></select></label><label class="field"><span>Application title</span><input data-builder-title value="${escapeHtml(draft.title)}" placeholder="Wildfire briefing" /></label><label class="field"><span>View</span><select data-builder-mode><option value="edit"${draft.mode === "edit" ? " selected" : ""}>Edit</option><option value="present"${draft.mode === "present" ? " selected" : ""}>Present</option></select></label></div><div class="application-builder__section"><h3>Panel gallery</h3><p class="application-builder__hint">Add working tools to the layout. Singleton tools show “Added”; conditional tools explain what they need.</p><div class="application-builder__gallery">${panelTypes.map((panel) => { const availability = panel.availability({ layers, draft }); const added = !panel.multiple && draft.panels.some((item) => item.type === panel.type); const disabled = added || !availability.available || panel.status === "planned"; const reason = added ? "Already added to this application." : availability.reason; return `<button type="button" data-builder-add="${escapeHtml(panel.type)}"${disabled ? " disabled" : ""} title="${escapeHtml(reason || panel.description)}"><span><strong>${disabled ? "" : "+ "}${escapeHtml(panel.displayName)}</strong><em>${added ? "Added" : panel.status === "conditional" ? "Conditional" : "Ready"}</em></span><small>${escapeHtml(reason || panel.description)}</small></button>`; }).join("")}</div><details class="application-builder__roadmap"><summary>Planned extensions</summary><p>Legend, swipe, timeline, media, and embed will appear here only after they have working panel implementations.</p></details></div><div class="application-builder__section"><h3>Current panel instances</h3><div class="application-builder__instances">${panelRows || `<p class="application-builder__notice">Add at least one panel. The map and project data remain available even when no panels are shown.</p>`}</div></div><p class="application-builder__notice">Panels share project state. Closing a panel removes only its interface; layers, drawings, feeds, selections, and saved analysis stay with the project. Audience visibility controls presentation UI, not data permissions.</p><button type="button" class="button--quiet" data-builder-save-copy>Save as new presentation</button>`;
      const skinSelect = root.querySelector("[data-builder-skin]");
      [["tidal-95", "Tidal ’95"], ["portolan", "Portolan"], ["velvet-orbit", "Velvet Orbit"], ["violet-circuit", "Violet Circuit"]].forEach(([value, label]) => {
        if ([...skinSelect.options].some((option) => option.value === value)) return;
        skinSelect.add(new Option(label, value));
      });
      skinSelect.value = draft.skin;
      const layoutField = document.createElement("label");
      layoutField.className = "field";
      layoutField.innerHTML = `<span>Layout</span><select data-builder-layout><option value="workspace">Workspace docks</option><option value="bottom-nav">Bottom navigation</option><option value="bottom-workspace">Bottom workspace</option><option value="ai-map">AI Map</option><option value="globe">Orbital globe (optional)</option></select>`;
      root.querySelector(".application-builder__top").append(layoutField);
      layoutField.querySelector("select").value = draft.layout.kind;
      const resetLayout = document.createElement("button");
      resetLayout.type = "button";
      resetLayout.className = "button--quiet";
      resetLayout.dataset.builderResetLayout = "";
      resetLayout.textContent = "Reset layout";
      root.querySelector("[data-builder-save-copy]").before(resetLayout);
      const syncDraft = () => {
        draft.title = root.querySelector("[data-builder-title]").value.trim() || presetLabels[draft.preset];
        draft.skin = root.querySelector("[data-builder-skin]").value;
        draft.mode = root.querySelector("[data-builder-mode]").value;
        draft.layout = { ...draft.layout, kind: root.querySelector("[data-builder-layout]").value };
        root.querySelectorAll("[data-builder-instance]").forEach((row, index) => {
          const panel = draft.panels.find((item) => item.instanceId === row.dataset.builderInstance);
          if (!panel) return;
          panel.title = row.querySelector("[data-builder-panel-title]").value.trim() || panel.title;
          panel.placement = { ...panel.placement, region: row.querySelector("[data-builder-region]").value, order: index };
          const layerId = row.querySelector("[data-builder-layer]").value;
          panel.binding = layerId ? { ...panel.binding, layerId, followActiveLayer: false } : { ...panel.binding, layerId: null, followActiveLayer: true };
          const field = row.querySelector("[data-builder-field]")?.value;
          if (field !== undefined) panel.settings = { ...panel.settings, field: field || null };
          panel.audienceVisible = row.querySelector("[data-builder-audience]").checked;
        });
      };
      root.querySelector("[data-builder-preset]").addEventListener("change", (event) => {
        const title = draft.title;
        draft = presetApplication(event.target.value);
        if (title && title !== previous?.title) draft.title = title;
        render();
      });
      ["[data-builder-title]", "[data-builder-skin]", "[data-builder-mode]", "[data-builder-layout]"].forEach((selector) => root.querySelector(selector).addEventListener("change", syncDraft));
      resetLayout.addEventListener("click", () => {
        const preset = presetApplication(draft.preset);
        draft.layout = structuredClone(preset.layout);
        draft.panels = draft.panels.map((panel, order) => ({ ...panel, placement: { region: this.applicationRuntime.panels.get(panel.type)?.placements?.[0] || "left", order, size: { width: 360, height: 300 }, position: { x: 24 + order * 24, y: 80 + order * 24 } } }));
        render();
      });
      root.querySelectorAll("[data-builder-instance]").forEach((row) => {
        row.querySelectorAll("input, select").forEach((control) => control.addEventListener("change", syncDraft));
        row.querySelector("[data-builder-remove]").addEventListener("click", () => {
          syncDraft();
          draft.panels = draft.panels.filter((panel) => panel.instanceId !== row.dataset.builderInstance);
          render();
        });
        const move = (offset) => {
          syncDraft();
          const index = draft.panels.findIndex((panel) => panel.instanceId === row.dataset.builderInstance);
          const target = index + offset;
          if (index < 0 || target < 0 || target >= draft.panels.length) return;
          [draft.panels[index], draft.panels[target]] = [draft.panels[target], draft.panels[index]];
          render();
        };
        row.querySelector("[data-builder-up]")?.addEventListener("click", () => move(-1));
        row.querySelector("[data-builder-down]")?.addEventListener("click", () => move(1));
      });
      root.querySelectorAll("[data-builder-add]").forEach((button) => button.addEventListener("click", () => {
        syncDraft();
        const definition = this.applicationRuntime.panels.get(button.dataset.builderAdd);
        const count = draft.panels.filter((panel) => panel.type === definition.type).length + 1;
        draft.panels.push({ instanceId: `${definition.type}-${crypto.randomUUID?.() || Date.now()}`, type: definition.type, title: count > 1 ? `${definition.displayName} ${count}` : definition.displayName, placement: { region: definition.placements[0], order: draft.panels.length }, binding: { followActiveLayer: true }, settings: structuredClone(definition.defaults || {}), audienceVisible: true });
        render();
      }));
      root.querySelector("[data-builder-save-copy]").addEventListener("click", () => {
        syncDraft();
        const copy = normalizeApplicationConfig({ ...draft, configured: true, title: `${draft.title} copy` });
        this.projectManager.current.applications ??= [];
        this.projectManager.current.applications.push(copy);
        builderFinished = true;
        this.projectManager.setApplication(copy);
        this.dialog.close();
        this.toast(`Saved “${copy.title}” as a new presentation.`);
      });
      root.syncDraft = syncDraft;
    };
    this.openDialog({
      eyebrow: "Application builder",
      title: "Customize application",
      content: `<div class="application-builder" data-application-builder></div>`,
      actions: [
        { label: "Cancel", handler: () => { builderFinished = true; if (previewing) this.applicationRuntime.cancelPreview(); else if (!previous) this.applicationRuntime.deactivate(); this.dialog.close(); } },
        { label: "Reset", handler: () => { draft = presetApplication(draft.preset); render(); } },
        { label: "Preview", handler: () => { this.dialog.querySelector("[data-application-builder]").syncDraft?.(); this.applicationRuntime.apply(draft, { preview: true }); previewing = true; this.toast("Preview applied. Cancel restores the prior application."); } },
        { label: "Save", primary: true, handler: () => { this.dialog.querySelector("[data-application-builder]").syncDraft?.(); builderFinished = true; const saved = this.projectManager.setApplication(draft); this.applicationRuntime.commitPreview(); this.dialog.close(); this.toast(`Application “${saved.title}” saved.`); } },
      ],
    });
    this.dialog.addEventListener("close", () => {
      if (builderFinished || !previewing) return;
      this.applicationRuntime.cancelPreview();
    }, { once: true });
    render();
  }

  #presentationDialog() {
    const previous = structuredClone(this.projectManager.current.presentation || {});
    const current = { template: "standard", skin: "clean-light", title: "", primaryLayerId: null, ...previous };
    const layers = this.mapController.getOperationalLayers();
    const cards = [
      ["briefing", "Briefing", "Understand events, changes, and their sources", "dark-analytical"],
      ["explorer", "Explorer", "Search, filter, and compare mapped records", "clean-light"],
      ["atlas", "Atlas", "Present places through guided chapters and stories", "retro-print"],
    ];
    this.openDialog({
      eyebrow: "Presentation",
      title: "Choose a data theme",
      content: `<div class="presentation-picker"><p class="form-note">Templates change the working interface. Skins change the complete visual system without changing map symbology or classifications.</p><div class="presentation-cards"><button type="button" class="presentation-card" data-presentation-template="standard"><span class="presentation-preview presentation-preview--standard"></span><strong>Standard workspace</strong><small>Restore the authoring workspace.</small></button>${cards.map(([id, title, description]) => `<button type="button" class="presentation-card" data-presentation-template="${id}"><span class="presentation-preview presentation-preview--${id}"><i></i><i></i><i></i></span><strong>${title}</strong><small>${description}</small></button>`).join("")}</div><p class="form-note" data-presentation-preview-status></p><fieldset class="skin-picker"><legend>Interface skin</legend>${[["clean-light","Clean Light","Modern analytical workspace"],["dark-analytical","Midnight","Quiet professional night interface"],["tidal-95","Pacific ’94","Classic digital cartography"],["portolan","Copperplate","Historical atlas and field journal"],["velvet-orbit","Velvet Orbit","Editorial presentation"],["violet-circuit","Violet Circuit","Operational console"]].map(([id,label,description]) => `<button type="button" class="skin-card skin-card--${id}" data-skin-choice="${id}"><span class="skin-mini"><i></i><b></b><em></em><small></small></span><strong>${label}</strong><small>${description}</small></button>`).join("")}<select id="presentation-skin" hidden><option value="clean-light">Clean Light</option><option value="dark-analytical">Midnight</option><option value="tidal-95">Pacific ’94</option><option value="portolan">Copperplate</option><option value="velvet-orbit">Velvet Orbit</option><option value="violet-circuit">Violet Circuit</option></select></fieldset><label class="field"><span>Presentation title</span><input id="presentation-title" value="${escapeHtml(current.title)}" placeholder="Optional title" /></label><label class="field"><span>Primary layer</span><select id="presentation-primary"><option value="">Choose later</option>${layers.map((layer) => `<option value="${escapeHtml(layer.uid)}">${escapeHtml(layer.title || "Untitled layer")}</option>`).join("")}</select></label><p class="form-note" data-presentation-note>Dataset roles remain configurable inside Explorer and Briefing after applying.</p></div>`,
      actions: [
        { label: "Cancel", handler: () => { this.#applyPresentation(previous); this.dialog.close(); } },
        { label: "Preview", handler: () => {
          const template = this.dialog.querySelector(".presentation-card.is-selected")?.dataset.presentationTemplate || current.template;
          this.#applyPresentation({ template, skin: this.dialog.querySelector("#presentation-skin").value });
        } },
        { label: "Apply", primary: true, handler: () => {
          const template = this.dialog.querySelector(".presentation-card.is-selected")?.dataset.presentationTemplate || current.template;
          const presentation = this.projectManager.setPresentation({ ...current, template, skin: this.dialog.querySelector("#presentation-skin").value, title: this.dialog.querySelector("#presentation-title").value.trim(), primaryLayerId: this.dialog.querySelector("#presentation-primary").value || null });
          this.#applyPresentation(presentation);
          this.dialog.close();
          this.toast(`${template === "standard" ? "Standard workspace" : `${template[0].toUpperCase()}${template.slice(1)} presentation`} applied.`);
        } },
      ],
    });
    const skin = this.dialog.querySelector("#presentation-skin");
    skin.value = current.skin;
    this.dialog.querySelector("#presentation-primary").value = current.primaryLayerId || "";
    const select = (button) => {
      this.dialog.querySelectorAll("[data-presentation-template]").forEach((card) => card.classList.toggle("is-selected", card === button));
      if (button.dataset.presentationTemplate !== "standard" && current.template === "standard") chooseSkin(cards.find(([id]) => id === button.dataset.presentationTemplate)?.[3] || skin.value);
      const template = button.dataset.presentationTemplate;
      this.#applyPresentation({ template, skin: skin.value });
      this.dialog.querySelector("[data-presentation-preview-status]").textContent = template === "standard"
        ? "Previewing the standard authoring workspace."
        : `Previewing ${template[0].toUpperCase()}${template.slice(1)}. Choose Apply to save this presentation to the project.`;
    };
    this.dialog.querySelectorAll("[data-presentation-template]").forEach((button) => button.addEventListener("click", () => select(button)));
    const chooseSkin = (value) => {
      skin.value = value;
      this.dialog.querySelectorAll("[data-skin-choice]").forEach((card) => card.classList.toggle("is-selected", card.dataset.skinChoice === value));
      const template = this.dialog.querySelector(".presentation-card.is-selected")?.dataset.presentationTemplate || current.template;
      this.#applyPresentation({ template, skin: skin.value });
    };
    this.dialog.querySelectorAll("[data-skin-choice]").forEach((card) => card.addEventListener("click", () => chooseSkin(card.dataset.skinChoice)));
    chooseSkin(current.skin === "retro-print" ? "portolan" : current.skin);
    select(this.dialog.querySelector(`[data-presentation-template="${current.template}"]`) || this.dialog.querySelector("[data-presentation-template=standard]"));
  }

  async #importProject(event) {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      const { project } = await this.projectManager.importFile(file);
      this.toast(`${project.name} imported.`);
    } catch (error) {
      this.error(error.message);
    }
  }

  async #addFiles(event) {
    const files = [...event.target.files];
    event.target.value = "";
    for (const file of files) {
      try {
        const layer = await this.mapController.addLocalFile(file);
        this.toast(`${layer.title} added.`);
        await this.mapController.goToLayerOnInitialLoad(layer).catch(() => {});
      } catch (error) {
        this.error(`${file.name}: ${error.message}`);
      }
    }
  }

  async #loadTool(event) {
    const [file] = event.target.files;
    event.target.value = "";
    if (!file) return;
    try {
      await this.toolManager.load(file);
    } catch (error) {
      this.error(error.message);
    }
  }

  async #search(event) {
    event.preventDefault();
    const input = document.querySelector("#place-query");
    if (this.searchSelection >= 0 && this.searchResults[this.searchSelection]) {
      await this.#selectSearchResult(this.searchSelection);
      return;
    }
    await this.#runPlaceSearch(input.value, true);
  }

  #schedulePlaceSearch(value) {
    clearTimeout(this.searchTimer);
    this.searchRequestId += 1;
    const query = value.trim();
    if (query.length < 2) {
      this.searchRequestId += 1;
      this.#clearSearchResults();
      return;
    }
    this.searchTimer = setTimeout(() => this.#runPlaceSearch(query), 250);
  }

  async #runPlaceSearch(value, fromSubmit = false) {
    const input = document.querySelector("#place-query");
    const container = document.querySelector("#search-results");
    const query = value.trim();
    if (!query) {
      this.#clearSearchResults();
      return;
    }
    const requestId = ++this.searchRequestId;
    container.hidden = false;
    input.setAttribute("aria-expanded", "true");
    container.innerHTML = '<div class="loading-row"><span></span> Searching…</div>';
    try {
      const results = await this.mapController.searchPlaces(query);
      if (requestId !== this.searchRequestId || input.value.trim() !== query) return;
      this.searchResults = results;
      this.searchSelection = fromSubmit && results.length === 1 ? 0 : -1;
      container.innerHTML = this.searchResults.length
        ? this.searchResults.map((result, index) => `<button type="button" role="option" data-search-index="${index}" aria-selected="${index === this.searchSelection}">${escapeHtml(result.label)}</button>`).join("")
        : '<div class="empty-state">No matching places found.</div>';
      container.querySelectorAll("[data-search-index]").forEach((button) =>
        button.addEventListener("click", () => this.#selectSearchResult(Number(button.dataset.searchIndex))),
      );
      if (fromSubmit && this.searchResults.length === 1) await this.#selectSearchResult(0);
    } catch (error) {
      if (requestId !== this.searchRequestId) return;
      container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }

  #moveSearchSelection(delta) {
    if (!this.searchResults.length || document.querySelector("#search-results").hidden) return;
    this.searchSelection = (this.searchSelection + delta + this.searchResults.length) % this.searchResults.length;
    document.querySelectorAll("#search-results [data-search-index]").forEach((button, index) => {
      button.setAttribute("aria-selected", String(index === this.searchSelection));
      if (index === this.searchSelection) button.scrollIntoView({ block: "nearest" });
    });
  }

  async #selectSearchResult(index) {
    const result = this.searchResults[index];
    if (!result) return;
    document.querySelector("#place-query").value = result.label;
    this.#clearSearchResults();
    await this.mapController.goToSearchResult(result);
  }

  #clearSearchResults() {
    clearTimeout(this.searchTimer);
    this.searchRequestId += 1;
    this.searchResults = [];
    this.searchSelection = -1;
    const container = document.querySelector("#search-results");
    container.replaceChildren();
    container.hidden = true;
    document.querySelector("#place-query").setAttribute("aria-expanded", "false");
  }

  async #addBookmark() {
    const view = this.mapController.view;
    const name = document.querySelector("#place-query").value.trim() || `View at ${view.center.latitude.toFixed(3)}, ${view.center.longitude.toFixed(3)}`;
    const address = await this.mapController.reverseGeocode(view.center).catch(() => null);
    this.projectManager.addBookmark({
      name,
      description: "",
      longitude: view.center.longitude,
      latitude: view.center.latitude,
      reverseAddress: address?.address || "",
      viewpoint: this.mapController.getViewState(),
      basemapId: this.mapController.getBasemapId(),
      lingerSeconds: 4,
      layerVisibility: this.mapController.getOperationalLayers().map((layer) => ({ key: this.#atlasLayerKey(layer), visible: layer.visible })),
    });
  }

  #bookmarkManagerDialog() {
    const bookmarks = this.projectManager.current.bookmarks ?? [];
    const rows = bookmarks.map((bookmark) => `<article class="bookmark-editor" data-bookmark-editor="${escapeHtml(bookmark.id)}"><label class="field"><span>Name</span><input data-bookmark-name value="${escapeHtml(bookmark.name)}" /></label><label class="field"><span>Description</span><textarea data-bookmark-description rows="2">${escapeHtml(bookmark.description || "")}</textarea></label><div class="bookmark-editor__coordinates"><label>Longitude<input data-bookmark-longitude type="number" step="0.000001" value="${escapeHtml(bookmark.longitude ?? bookmark.viewpoint?.center?.[0] ?? "")}" /></label><label>Latitude<input data-bookmark-latitude type="number" step="0.000001" value="${escapeHtml(bookmark.latitude ?? bookmark.viewpoint?.center?.[1] ?? "")}" /></label></div></article>`).join("") || `<p class="form-note">Add a current view first. Bookmarks retain Atlas-compatible camera, basemap, layer-state, description, and linger settings.</p>`;
    this.openDialog({
      eyebrow: "Bookmarks",
      title: "Manage saved places",
      content: `<div class="bookmark-manager"><p class="form-note">Edit saved places, export a location spreadsheet, or turn this set directly into a Guided Places atlas.</p><div class="bookmark-editor-list">${rows}</div></div>`,
      actions: [
        { label: "Download CSV", handler: () => this.#downloadBookmarksCsv() },
        { label: "Download .gmoatlas", handler: () => { this.#saveBookmarkEdits(); this.#createAtlasFromBookmarks(); this.projectManager.exportAtlas(); this.dialog.close(); } },
        { label: "Create Atlas", handler: () => { this.#saveBookmarkEdits(); this.#createAtlasFromBookmarks(); this.dialog.close(); } },
        { label: "Save changes", primary: true, handler: () => { this.#saveBookmarkEdits(); this.dialog.close(); } },
      ],
    });
  }

  #saveBookmarkEdits() {
    this.dialog.querySelectorAll("[data-bookmark-editor]").forEach((row) => this.projectManager.updateBookmark(row.dataset.bookmarkEditor, {
      name: row.querySelector("[data-bookmark-name]").value.trim() || "Saved place",
      description: row.querySelector("[data-bookmark-description]").value.trim(),
      longitude: Number(row.querySelector("[data-bookmark-longitude]").value),
      latitude: Number(row.querySelector("[data-bookmark-latitude]").value),
    }));
  }

  #downloadBookmarksCsv() {
    const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
    const csv = ["Name,Longitude,Latitude,Description", ...(this.projectManager.current.bookmarks ?? []).map((item) => [item.name, item.longitude ?? item.viewpoint?.center?.[0] ?? "", item.latitude ?? item.viewpoint?.center?.[1] ?? "", item.description ?? ""].map(quote).join(","))].join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `${this.projectManager.current.name || "bookmarks"}-bookmarks.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 5000);
  }

  #createAtlasFromBookmarks() {
    const chapters = (this.projectManager.current.bookmarks ?? []).map((bookmark, index) => ({
      id: bookmark.id || `bookmark-${index + 1}`,
      title: bookmark.name || `Place ${index + 1}`,
      body: bookmark.description || "",
      reverseAddress: bookmark.reverseAddress || "",
      viewState: bookmark.viewpoint,
      basemapId: bookmark.basemapId || null,
      lingerSeconds: Math.min(120, Math.max(1, Number(bookmark.lingerSeconds) || 4)),
      layerVisibility: bookmark.layerVisibility || null,
    }));
    if (!chapters.length) return this.error("Add at least one bookmark before creating an atlas.");
    const presentation = this.projectManager.setPresentation({ ...this.projectManager.current.presentation, template: "atlas", title: this.projectManager.current.presentation?.title || "Guided places", chapters });
    this.#applyPresentation(presentation);
    this.toast("Created Guided Places from bookmarks.");
  }

  #renderBookmarks() {
    const bookmarks = this.projectManager.current.bookmarks ?? [];
    const container = document.querySelector("#bookmarks-list");
    container.classList.toggle("muted", !bookmarks.length);
    container.innerHTML = bookmarks.length
      ? bookmarks.map((bookmark) => `<div class="bookmark-row"><button data-bookmark-id="${escapeHtml(bookmark.id)}">${escapeHtml(bookmark.name)}${bookmark.description ? `<small>${escapeHtml(bookmark.description)}</small>` : ""}</button><button data-bookmark-edit="${escapeHtml(bookmark.id)}" aria-label="Edit bookmark">✎</button><button data-bookmark-remove="${escapeHtml(bookmark.id)}" aria-label="Remove bookmark">×</button></div>`).join("")
      : "No saved locations yet.";
    container.querySelectorAll("[data-bookmark-id]").forEach((button) =>
      button.addEventListener("click", () => {
        const item = bookmarks.find((bookmark) => bookmark.id === button.dataset.bookmarkId);
        if (item) this.mapController.restoreView(item.viewpoint);
      }),
    );
    container.querySelectorAll("[data-bookmark-remove]").forEach((button) =>
      button.addEventListener("click", () => this.projectManager.removeBookmark(button.dataset.bookmarkRemove)),
    );
    container.querySelectorAll("[data-bookmark-edit]").forEach((button) => button.addEventListener("click", () => this.#bookmarkManagerDialog()));
  }

  #renderLayers() {
    const layers = this.mapController.getOperationalLayers().slice().reverse();
    if (this.utilityStyleLayerUid && !this.mapController.findLayer(this.utilityStyleLayerUid)) {
      this.utilityStyleLayerUid = null;
      document.querySelector("#utility-style-content").replaceChildren();
      this.#syncUtilityPanel();
    }
    const welcomePanel = document.querySelector("#welcome-panel");
    if (layers.length && !this.keepWelcomeForSharedExample) this.#dismissWelcome();
    const applicationPreset = this.applicationRuntime?.snapshot?.().preset || "standard";
    welcomePanel.hidden = welcomePanel.dataset.dismissed === "true" || applicationPreset !== "standard";
    const exportable = new Set(this.exportController.listExportableLayers().map((layer) => layer.uid));
    document.querySelector("#layer-count").textContent = `${layers.length} loaded`;
    const container = document.querySelector("#layers-list");
    container.innerHTML = layers.length
      ? layers.map((layer) => {
        const config = this.mapController.getLayerConfig(layer);
        const scaleMessage = this.#layerScaleMessage(layer);
        return `<article class="layer-card" data-layer-uid="${escapeHtml(layer.uid)}">
          <div class="layer-card__head"><label class="layer-toggle"><input type="checkbox" data-layer-visible ${layer.visible ? "checked" : ""} /><span></span></label><div><strong title="${escapeHtml(layer.title)}">${escapeHtml(layer.title)}</strong><small>${escapeHtml(config.sourceType)}${config.definitionExpression ? " · Filtered" : ""}${config.refreshInterval ? ` · ${config.refreshInterval}m refresh` : ""}</small></div><button data-layer-action="remove" title="Remove layer">×</button></div>
          <div class="layer-scale-note" data-layer-scale-note ${scaleMessage ? "" : "hidden"}>${escapeHtml(scaleMessage || "")}</div>
          <label class="opacity-row"><span>Opacity</span><input data-layer-opacity type="range" min="0" max="1" step="0.05" value="${layer.opacity}" /><output>${Math.round(layer.opacity * 100)}%</output></label>
          <div class="layer-card__actions"><button data-layer-action="zoom">Zoom</button><button data-layer-action="table">Table</button><button data-layer-action="filter">Filter</button><button data-layer-action="export" ${exportable.has(layer.uid) ? "" : "disabled title=\"This layer is not queryable\""}>Export</button><button data-layer-action="style">Style</button><button data-layer-action="refresh">Refresh</button></div>
        </article>`;
      }).join("")
      : '<div class="empty-state">Add a file or service from the Data menu.</div>';
    container.querySelectorAll(".layer-card").forEach((card) => this.#bindLayerCard(card));
  }

  #layerScaleMessage(layer) {
    if (!layer?.visible || !this.mapController.view) return "";
    const scale = Number(this.mapController.view.scale);
    const minScale = Number(layer.minScale) || 0;
    const maxScale = Number(layer.maxScale) || 0;
    const formatScale = (value) => `1:${Math.round(value).toLocaleString()}`;
    if (minScale && scale > minScale) return `Not visible at this scale · zoom in to ${formatScale(minScale)}`;
    if (maxScale && scale < maxScale) return `Not visible at this scale · zoom out to ${formatScale(maxScale)}`;
    return "";
  }

  #updateLayerScaleIndicators() {
    document.querySelectorAll(".layer-card[data-layer-uid]").forEach((card) => {
      const note = card.querySelector("[data-layer-scale-note]");
      const message = this.#layerScaleMessage(this.mapController.findLayer(card.dataset.layerUid));
      if (!note) return;
      note.textContent = message;
      note.hidden = !message;
    });
  }

  #bindLayerCard(card) {
    const uid = card.dataset.layerUid;
    card.querySelector("[data-layer-visible]").addEventListener("change", (event) => this.mapController.setVisibility(uid, event.target.checked));
    card.querySelector("[data-layer-opacity]").addEventListener("input", (event) => {
      this.mapController.setOpacity(uid, event.target.value);
      event.target.nextElementSibling.value = `${Math.round(event.target.value * 100)}%`;
    });
    card.querySelectorAll("[data-layer-action]").forEach((button) => button.addEventListener("click", async () => {
      const layer = this.mapController.findLayer(uid);
      switch (button.dataset.layerAction) {
        case "remove": this.mapController.removeLayer(uid); break;
        case "zoom": {
          const zoomed = layer ? await this.mapController.goToLayer(layer) : false;
          if (!zoomed) this.toast("This layer has a near-global or invalid extent. Use a filter or select a feature to zoom safely.");
          break;
        }
        case "table": this.events.publish("table:open", { uid }); break;
        case "filter": await this.#filterDialog(uid); break;
        case "export": this.#exportDialog(uid); break;
        case "style": this.#openSymbologyUtility(uid); break;
        case "refresh": this.#refreshDialog(uid); break;
      }
    }));
  }

  async #filterDialog(uid) {
    const layer = this.mapController.findLayer(uid);
    if (!layer || !("definitionExpression" in layer)) {
      throw new Error("This layer does not support attribute filters.");
    }
    await layer.load?.();
    const fields = (layer.fields ?? []).filter((field) => field.name);
    if (!fields.length) throw new Error("This layer does not expose fields that can be filtered.");
    const fieldOptions = fields.map((field) =>
      `<option value="${escapeHtml(field.name)}" data-field-type="${escapeHtml(field.type || "string")}">${escapeHtml(field.alias || field.name)}</option>`,
    ).join("");
    this.openDialog({
      eyebrow: "Attribute query",
      title: `Filter ${layer.title || "layer"}`,
      content: `<div class="filter-builder"><label class="field"><span>Field</span><select id="filter-field">${fieldOptions}</select></label><label class="field"><span>Operator</span><select id="filter-operator"></select></label><label class="field" id="filter-value-field"><span>Value</span><input id="filter-value" autocomplete="off" /></label></div>${layer.definitionExpression ? `<p class="form-note"><strong>Current filter:</strong> <code>${escapeHtml(layer.definitionExpression)}</code></p>` : '<p class="form-note">Only matching features will draw, appear in identify results, and be returned by the attribute table.</p>'}`,
      actions: [
        { label: "Clear filter", handler: () => {
          this.mapController.setDefinitionExpression(uid, null);
          this.dialog.close();
          this.toast("Layer filter cleared.");
        }},
        { label: "Apply filter", primary: true, handler: () => {
          try {
            const field = fields.find((item) => item.name === this.dialog.querySelector("#filter-field").value);
            const operator = this.dialog.querySelector("#filter-operator").value;
            const value = this.dialog.querySelector("#filter-value").value;
            const expression = this.#buildFilterExpression(field, operator, value);
            this.mapController.setDefinitionExpression(uid, expression);
            this.dialog.close();
            this.toast(`Filter applied: ${expression}`);
          } catch (error) { this.error(error.message); }
        }},
      ],
    });

    const fieldSelect = this.dialog.querySelector("#filter-field");
    const operatorSelect = this.dialog.querySelector("#filter-operator");
    const valueField = this.dialog.querySelector("#filter-value-field");
    const valueInput = this.dialog.querySelector("#filter-value");
    const updateOperators = () => {
      const field = fields.find((item) => item.name === fieldSelect.value);
      const type = String(field?.type || "string").toLowerCase();
      const comparable = !type.includes("string") && !type.includes("guid") && !type.includes("global-id");
      const operators = comparable
        ? [["eq", "equals"], ["ne", "does not equal"], ["gt", "is greater than"], ["gte", "is at least"], ["lt", "is less than"], ["lte", "is at most"], ["null", "is empty"], ["not-null", "is not empty"]]
        : [["eq", "equals"], ["ne", "does not equal"], ["contains", "contains"], ["starts", "starts with"], ["null", "is empty"], ["not-null", "is not empty"]];
      operatorSelect.innerHTML = operators.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
      valueInput.type = type.includes("date") ? "date" : comparable ? "number" : "text";
      valueInput.step = "any";
      valueInput.value = "";
      valueField.hidden = false;
    };
    fieldSelect.addEventListener("change", updateOperators);
    operatorSelect.addEventListener("change", () => {
      valueField.hidden = ["null", "not-null"].includes(operatorSelect.value);
    });
    updateOperators();
  }

  #buildFilterExpression(field, operator, rawValue) {
    if (!field?.name) throw new Error("Choose a field to filter.");
    if (operator === "null") return `${field.name} IS NULL`;
    if (operator === "not-null") return `${field.name} IS NOT NULL`;
    const value = String(rawValue ?? "").trim();
    if (!value) throw new Error("Enter a filter value.");
    const type = String(field.type || "string").toLowerCase();
    let literal;
    if (type.includes("date")) literal = `DATE '${value.replaceAll("'", "''")}'`;
    else if (!type.includes("string") && !type.includes("guid") && !type.includes("global-id")) {
      const number = Number(value);
      if (!Number.isFinite(number)) throw new Error("Enter a valid numeric value.");
      literal = String(number);
    } else literal = `'${value.replaceAll("'", "''")}'`;
    const comparisons = { eq: "=", ne: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
    if (comparisons[operator]) return `${field.name} ${comparisons[operator]} ${literal}`;
    if (operator === "contains") return `${field.name} LIKE '%${value.replaceAll("'", "''")}%'`;
    if (operator === "starts") return `${field.name} LIKE '${value.replaceAll("'", "''")}%'`;
    throw new Error("Choose a valid filter operator.");
  }

  #openSymbologyUtility(uid) {
    const layer = this.mapController.findLayer(uid);
    if (!layer) return;
    this.utilityStyleLayerUid = uid;
    const pane = document.querySelector("#utility-style-content");
    const fields = (layer.fields ?? []).filter((field) => field?.name && !/^(?:geometry)$/i.test(field.type || ""));
    // Object IDs are storage keys, not meaningful values for classification or
    // 3D heights. Prefer a measurement-like field when a renderer has none.
    const numericFields = fields.filter((field) => /^(?:small-integer|integer|single|double|long)$/i.test(field.type || ""));
    const preferredNumericField = numericFields.find((field) => /(?:^|\b)(?:value|concentration|amount|measurement|pm2?\.5)(?:\b|$)/i.test(`${field.name} ${field.alias || ""}`))
      ?? numericFields.find((field) => !/(?:^|_)id$/i.test(field.name))
      ?? numericFields[0];
    const renderer = layer.renderer?.toJSON?.() ?? layer.renderer ?? {};
    const rendererMode = renderer.type === "unique-value" ? "categorized" : renderer.type === "class-breaks" ? "graduated" : "simple";
    const representativeSymbol = renderer.symbol ?? renderer.classBreakInfos?.[0]?.symbol ?? renderer.uniqueValueInfos?.[0]?.symbol;
    const objectSymbol = representativeSymbol?.symbolLayers?.find((symbolLayer) => symbolLayer.type === "object" || symbolLayer.type === "extrude");
    const heightVariable = renderer.visualVariables?.find((variable) => variable.type === "size" && (variable.axis === "height" || layer.geometryType === "polygon"));
    const expressionField = String(heightVariable?.valueExpression || "").match(/\$feature\[(?:"([^"]+)"|'([^']+)')\]/)?.slice(1).find(Boolean);
    const expressionMultiplier = Number(String(heightVariable?.valueExpression || "").match(/\*\s*([0-9]+(?:\.[0-9]+)?)/)?.[1]);
    const extrusionEnabledByRenderer = Boolean(objectSymbol && (heightVariable || Number(objectSymbol.height ?? objectSymbol.size) > 1));
    const initialExtrusionSource = heightVariable ? "field" : "fixed";
    const extrusionField = heightVariable?.field || expressionField || preferredNumericField?.name || "";
    const fieldOptions = (items, emptyLabel, selected = "") => items.length
      ? items.map((field) => `<option value="${escapeHtml(field.name)}"${field.name === selected ? " selected" : ""}>${escapeHtml(field.alias || field.name)} (${escapeHtml(field.name)})</option>`).join("")
      : `<option value="">${emptyLabel}</option>`;
    const rendererControls = fields.length
      ? `<label class="field"><span>Style type</span><select data-style-mode><option value="simple"${rendererMode === "simple" ? " selected" : ""}>Simple</option><option value="categorized"${rendererMode === "categorized" ? " selected" : ""}>Categorized by field</option><option value="graduated"${rendererMode === "graduated" ? " selected" : ""}>Graduated by numeric field</option></select></label><label class="field" data-style-field-control hidden><span>Style field</span><select data-style-field>${fieldOptions(fields, "No fields available", renderer.field || preferredNumericField?.name)}</select></label>`
      : "";
    const polygonControls = layer.geometryType === "polygon"
      ? '<label class="opacity-row"><span>Fill opacity</span><input data-symbol-fill-opacity type="range" min="0" max="1" step="0.05" value="0.35" /><output>35%</output></label><label class="display-checkbox"><input data-symbol-no-fill type="checkbox" /><span>No fill — outline only</span></label>'
      : "";
    const extrudable = ["polygon", "point", "multipoint"].includes(layer.geometryType);
    const extrusionControls = extrudable
      ? `<fieldset class="feedback-settings"><legend>3D extrusion</legend><label class="display-checkbox"><input data-extrusion-enabled type="checkbox"${extrusionEnabledByRenderer ? " checked" : ""} /><span>Extrude in 3D</span></label><div data-extrusion-options hidden><div class="field-grid"><label class="field"><span>Height source</span><select data-extrusion-source><option value="fixed"${initialExtrusionSource === "fixed" ? " selected" : ""}>Fixed height</option><option value="field"${initialExtrusionSource === "field" ? " selected" : ""}>Numeric field</option></select></label><label class="field" data-extrusion-value-control><span>Height <small>meters</small></span><input data-extrusion-value type="number" min="0" step="1" value="${Number(objectSymbol?.height ?? objectSymbol?.size) || 250}" /></label><label class="field" data-extrusion-field-control hidden><span>Height field</span><select data-extrusion-field>${fieldOptions(numericFields, "No numeric fields available", extrusionField)}</select></label><label class="field" data-extrusion-multiplier-control hidden><span>Height multiplier</span><input data-extrusion-multiplier type="number" min="0" step="0.01" value="${Number.isFinite(expressionMultiplier) ? expressionMultiplier : 1}" /></label>${layer.geometryType === "polygon" ? "" : `<label class="field"><span>Column width <small>meters</small></span><input data-extrusion-width type="number" min="1" step="50" value="${Number(objectSymbol?.width) || 650}" /></label>`}</div></div></fieldset>`
      : "";
    pane.innerHTML = `<div class="workspace-tool"><p class="eyebrow">Layer presentation</p><h3>Style ${escapeHtml(layer.title || "layer")}</h3><div class="field-grid">${rendererControls}<label class="field"><span>Fill / marker / line</span><input data-symbol-color type="color" value="#1b7f6a" /></label><label class="field"><span>Outline</span><input data-symbol-outline type="color" value="#ffffff" /></label><label class="field"><span>Size / width</span><input data-symbol-size type="number" min="0.5" max="40" step="0.5" value="9" /></label></div>${polygonControls}${extrusionControls}<p class="form-note">Field styles sample up to 1,000 records matching the active layer filter. Renderer JSON is stored with the project.</p><div class="workspace-tool__actions"><button type="button" class="button--primary" data-apply-symbology>Apply symbology</button></div></div>`;
    const fillOpacity = pane.querySelector("[data-symbol-fill-opacity]");
    fillOpacity?.addEventListener("input", () => {
      fillOpacity.nextElementSibling.value = `${Math.round(Number(fillOpacity.value) * 100)}%`;
    });
    const styleMode = pane.querySelector("[data-style-mode]");
    const styleFieldControl = pane.querySelector("[data-style-field-control]");
    const styleField = pane.querySelector("[data-style-field]");
    const syncStyleField = () => {
      if (!styleMode || !styleFieldControl || !styleField) return;
      const needsField = styleMode.value !== "simple";
      styleFieldControl.hidden = !needsField;
      if (!needsField) return;
      const available = styleMode.value === "graduated" ? numericFields : fields;
      styleField.innerHTML = fieldOptions(available, styleMode.value === "graduated" ? "No numeric fields available" : "No fields available", renderer.field || preferredNumericField?.name);
      styleField.disabled = !available.length;
    };
    styleMode?.addEventListener("change", syncStyleField);
    syncStyleField();
    const extrusionEnabled = pane.querySelector("[data-extrusion-enabled]");
    const extrusionOptions = pane.querySelector("[data-extrusion-options]");
    const extrusionSource = pane.querySelector("[data-extrusion-source]");
    const extrusionValueControl = pane.querySelector("[data-extrusion-value-control]");
    const extrusionFieldControl = pane.querySelector("[data-extrusion-field-control]");
    const extrusionMultiplierControl = pane.querySelector("[data-extrusion-multiplier-control]");
    const syncExtrusion = () => {
      if (!extrusionEnabled || !extrusionOptions) return;
      extrusionOptions.hidden = !extrusionEnabled.checked;
      const usingField = extrusionSource?.value === "field";
      if (extrusionValueControl) extrusionValueControl.hidden = usingField;
      if (extrusionFieldControl) extrusionFieldControl.hidden = !usingField;
      if (extrusionMultiplierControl) extrusionMultiplierControl.hidden = !usingField;
    };
    extrusionEnabled?.addEventListener("change", syncExtrusion);
    extrusionSource?.addEventListener("change", syncExtrusion);
    syncExtrusion();
    pane.querySelector("[data-apply-symbology]").addEventListener("click", async () => {
      try {
        await this.mapController.setLayerSymbology(uid, {
          mode: styleMode?.value || "simple",
          field: styleField?.value,
          color: pane.querySelector("[data-symbol-color]").value,
          outline: pane.querySelector("[data-symbol-outline]").value,
          size: pane.querySelector("[data-symbol-size]").value,
          fillOpacity: fillOpacity?.value,
          noFill: pane.querySelector("[data-symbol-no-fill]")?.checked ?? false,
          extrusionEnabled: extrusionEnabled?.checked ?? false,
          extrusionSource: extrusionSource?.value || "fixed",
          extrusionValue: pane.querySelector("[data-extrusion-value]")?.value,
          extrusionField: pane.querySelector("[data-extrusion-field]")?.value,
          extrusionMultiplier: pane.querySelector("[data-extrusion-multiplier]")?.value,
          extrusionWidth: pane.querySelector("[data-extrusion-width]")?.value,
        });
        const persisted = this.projectManager.persistCurrentIfSaved();
        this.toast(`Updated ${layer.title || "layer"} symbology${persisted ? " and saved it" : ""}.`);
      } catch (error) { this.error(error.message); }
    });
    this.#syncUtilityPanel("style");
  }

  #refreshDialog(uid) {
    const layer = this.mapController.findLayer(uid);
    const current = "refreshInterval" in layer ? layer.refreshInterval ?? 0 : 0;
    this.openDialog({
      eyebrow: "Live data",
      title: `Refresh ${layer?.title || "layer"}`,
      content: `<label class="field"><span>Refresh interval <small>minutes; 0 disables</small></span><input id="layer-refresh" type="number" min="0" step="0.5" value="${current}" /></label>`,
      actions: [
        { label: "Refresh now", handler: () => { layer.refresh?.(); this.toast("Refresh requested."); } },
        { label: "Save interval", primary: true, handler: () => {
          try {
            this.mapController.setRefreshInterval(uid, this.dialog.querySelector("#layer-refresh").value);
            this.dialog.close();
          } catch (error) { this.error(error.message); }
        }},
      ],
    });
  }

  #renderInsight(payload) {
    this.lastInsight = payload;
    this.identifyPending = false;
    const results = payload.results ?? [];
    const visibleResults = results.slice(0, 12);
    this.selectedInsightIndexes = new Set(visibleResults.length ? [0] : []);
    payload.selectedResults = visibleResults.length ? [visibleResults[0]] : [];
    const tabsHtml = visibleResults.length > 1
      ? `<div class="insight-tabs" role="tablist" aria-label="Identified features">${visibleResults.map((result, index) =>
          `<button type="button" role="tab" id="insight-tab-${index}" data-insight-tab="${index}" aria-controls="insight-panel-${index}" aria-selected="${index === 0}">${escapeHtml(result.layerTitle)} ${index + 1}</button>`,
        ).join("")}</div>`
      : "";
    const aiEnabled = this.aiController.isConfigured();
    document.querySelector("#insights-ai").hidden = !aiEnabled;
    const resultHtml = visibleResults.map((result, index) => {
        const layer = this.mapController.findLayer(result.layerUid);
        const fieldsByName = new Map((layer?.fields ?? []).map((field) => [field.name, field]));
        const entries = Object.entries(result.attributes ?? {}).filter(([, value]) => value !== null && value !== "");
        const selection = aiEnabled
          ? `<label class="insight-ai-select"><input type="checkbox" data-ai-selection="${index}" ${index === 0 ? "checked" : ""}> Include in AI</label>`
          : "";
        return `<article class="insight-panel" id="insight-panel-${index}" role="tabpanel" aria-labelledby="insight-tab-${index}" ${index === 0 ? "" : "hidden"}><header><span><strong>${escapeHtml(result.layerTitle)}</strong><small>${escapeHtml(result.kind)}</small></span>${selection}</header><dl>${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatAttributeValue(value, fieldsByName.get(key), key))}</dd></div>`).join("") || "<div><dd>No attributes returned.</dd></div>"}</dl></article>`;
      }).join("");
    this.#renderIntelligenceContents(payload);
    const overlay = document.querySelector("#insights-overlay");
    overlay.setAttribute("aria-busy", "false");
    if (results.length) {
      document.querySelector("#insights-title").textContent =
        results.length === 1 ? results[0].layerTitle : `${results.length} features`;
      document.querySelector("#insights-content").innerHTML = `${tabsHtml}${resultHtml}`;
      this.#setInsightsOpen(true);
      document.querySelectorAll("[data-insight-tab]").forEach((button) =>
        button.addEventListener("click", () => this.#activateInsightTab(Number(button.dataset.insightTab), true)),
      );
      document.querySelectorAll("[data-ai-selection]").forEach((input) =>
        input.addEventListener("change", () => this.#setInsightSelection(Number(input.dataset.aiSelection), input.checked)),
      );
      void this.mapController.highlightFeature(visibleResults[0], { pulse: false });
    } else {
      this.mapController.clearFeatureHighlight();
      document.querySelector("#insights-content").replaceChildren();
      this.#setInsightsOpen(false);
    }
  }

  #renderIntelligenceContents(payload = this.lastInsight) {
    const targets = [document.querySelector("#intelligence-content"), document.querySelector("#utility-intelligence-content")].filter(Boolean);
    const point = payload?.point;
    const coord = point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : "Unknown location";
    const selectedCount = payload?.selectedResults?.length ?? 0;
    const locationHtml = payload
      ? `<div class="location-card"><span class="eyebrow">Location</span><strong>${escapeHtml(payload.address?.address || coord)}</strong><small>${escapeHtml(coord)}</small></div>`
      : '<div class="intelligence-empty">Click a location to inspect its address, coordinates, and available context.</div>';
    const aiForm = this.aiController.isConfigured() && payload
      ? `<form class="ai-question"><label>Ask about this map context <small class="ai-selection-count">· ${selectedCount} feature${selectedCount === 1 ? "" : "s"} selected</small></label><div><input aria-label="Question about this map context" placeholder="What stands out here?" /><button>Ask AI</button></div></form>`
      : "";
    const responseHtml = this.lastAIResponseText
      ? `<section class="ai-response"><div class="ai-response__header"><span class="eyebrow">AI insights</span><span><button type="button" class="ai-response__download">Download report</button><button type="button" class="ai-response__clear">Clear insights</button></span></div><p class="ai-response__query"><strong>Query</strong><span>${escapeHtml(this.lastAIQueryText || "Map context query")}</span></p><div class="ai-response__markdown">${renderMarkdown(this.lastAIResponseText)}</div></section>`
      : "";
    const locationReportHtml = payload && !this.lastAIResponseText
      ? '<div class="intelligence-report-action"><button type="button" class="location-report-download">Download location report</button></div>'
      : "";
    const loadingHtml = this.identifyPending
      ? '<div class="loading-row"><span></span> Inspecting location…</div>'
      : this.aiPending ? '<div class="loading-row ai-loading"><span></span> Generating AI insights…</div>' : "";
    const html = `<div class="intelligence-toolbar"><button type="button" data-open-intelligence-utility title="Open Intelligence in the right panel">Open in right panel ↗</button></div>${loadingHtml}${locationHtml}${aiForm}${locationReportHtml}${responseHtml}`;
    targets.forEach((target) => {
      target.classList.toggle("intelligence-empty", !payload);
      target.innerHTML = html;
      target.querySelector("[data-open-intelligence-utility]")?.addEventListener("click", () => this.#openIntelligenceUtility());
      target.querySelector(".ai-question")?.addEventListener("submit", (event) => {
        event.preventDefault();
        const prompt = event.currentTarget.querySelector("input").value.trim();
        this.#askAI(
          prompt || "Summarize the current map extent, clicked location, loaded map layers, and any selected data. Identify useful patterns and geographic context.",
          payload,
          prompt || "Current map extent and location",
        );
      });
      target.querySelector(".ai-response__clear")?.addEventListener("click", () => {
        this.lastAIResponseText = null;
        this.lastAIQueryText = null;
        this.#renderIntelligenceContents();
      });
      target.querySelector(".ai-response__download")?.addEventListener("click", () => this.#downloadAIReport(payload));
      target.querySelector(".location-report-download")?.addEventListener("click", () => this.#downloadAIReport(payload));
    });
  }

  #askAI(prompt, payload = this.lastInsight, displayQuery = prompt) {
    if (document.body.dataset.navigationLayout === "top") this.#openIntelligenceUtility();
    this.lastAIQueryText = displayQuery;
    this.aiController.ask(prompt, payload).catch(() => {});
  }

  #activateInsightTab(index, selectFeature = false) {
    document.querySelectorAll("[data-insight-tab]").forEach((button) => {
      const active = Number(button.dataset.insightTab) === index;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(".insight-panel").forEach((panel, panelIndex) => {
      panel.hidden = panelIndex !== index;
    });
    const result = this.lastInsight?.results?.slice(0, 12)[index];
    if (selectFeature) {
      this.selectedInsightIndexes.add(index);
      const input = document.querySelector(`[data-ai-selection="${index}"]`);
      if (input) input.checked = true;
      this.#syncInsightSelection();
      if (result?.geometry) void this.mapController.goToFeature(result).catch(() => {});
    }
    void this.mapController.highlightFeature(result, { pulse: true });
  }

  #setInsightSelection(index, selected) {
    if (selected) this.selectedInsightIndexes.add(index);
    else this.selectedInsightIndexes.delete(index);
    this.#syncInsightSelection();
  }

  #syncInsightSelection() {
    if (!this.lastInsight) return;
    const visibleResults = this.lastInsight?.results?.slice(0, 12) ?? [];
    this.lastInsight.selectedResults = [...this.selectedInsightIndexes]
      .sort((a, b) => a - b)
      .map((index) => visibleResults[index])
      .filter(Boolean);
    const count = this.lastInsight.selectedResults.length;
    document.querySelectorAll(".ai-selection-count").forEach((label) => {
      label.textContent = `· ${count} feature${count === 1 ? "" : "s"} selected`;
    });
  }

  #showAIResponse(text) {
    this.lastAIResponseText = text;
    this.#renderIntelligenceContents();
    const activeContent = this.activeUtilityTab === "intelligence"
      ? document.querySelector("#utility-intelligence-content")
      : document.querySelector("#intelligence-content");
    activeContent?.querySelector(".ai-response")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async #downloadAIReport(payload = this.lastInsight) {
    if (!payload) {
      this.error("Click a location before downloading a report.");
      return;
    }
    const hasAIResponse = Boolean(this.lastAIResponseText);
    const margin = 48;
    const pageWidth = 612;
    const pageHeight = 792;
    const textEncoder = new TextEncoder();
    const dataUrlBytes = (dataUrl) => Uint8Array.from(atob(dataUrl.split(",")[1] || ""), (character) => character.charCodeAt(0));
    const toJpeg = (source, width = 96, height = 96) => new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, width, height);
        const scale = Math.min(width / image.naturalWidth, height / image.naturalHeight);
        const drawWidth = image.naturalWidth * scale;
        const drawHeight = image.naturalHeight * scale;
        context.drawImage(image, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
        resolve({ bytes: dataUrlBytes(canvas.toDataURL("image/jpeg", 0.92)), width, height });
      };
      image.onerror = () => resolve(null);
      image.src = source;
    });
    const logo = await toJpeg("./assets/gis-map-online-mark-v2.png", 96, 96);
    const mapCapture = await this.mapController.takeMapScreenshot().catch(() => null);
    const mapImage = mapCapture?.dataUrl
      ? { bytes: dataUrlBytes(mapCapture.dataUrl), width: mapCapture.width, height: mapCapture.height }
      : null;
    const safeText = (value) => String(value ?? "")
      // The built-in PDF fonts use a limited encoding. Preserve the meaning of
      // common map and measurement characters instead of emitting question marks.
      .replace(/[µμ]/g, "u").replace(/³/g, "3").replace(/²/g, "2")
      .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-")
      .replace(/[\\()]/g, "\\$&").replace(/[^\x20-\x7e]/g, "?");
    const wrap = (value, maxChars = 91) => String(value ?? "").split(/\n/).flatMap((paragraph) => {
      if (!paragraph.trim()) return [""];
      const words = paragraph.trim().split(/\s+/);
      const lines = [];
      let line = "";
      words.forEach((word) => {
        if (`${line} ${word}`.trim().length > maxChars && line) {
          lines.push(line);
          line = word;
        } else line = `${line} ${word}`.trim();
      });
      if (line) lines.push(line);
      return lines;
    });
    const pages = [];
    let page;
    let y;
    const newPage = () => {
      page = { commands: [
        "0.06 0.16 0.13 rg 48 712 516 32 re f",
        "1 1 1 rg BT /F2 14 Tf 96 724 Td (GIS MAP ONLINE) Tj ET",
        "0.08 0.37 0.30 rg BT /F2 11 Tf 48 682 Td (LOCATION INTELLIGENCE REPORT) Tj ET",
      ], images: [] };
      if (logo) {
        page.images.push({ name: "ImLogo", asset: logo });
        page.commands.push("q 24 0 0 24 60 716 cm /ImLogo Do Q");
      }
      pages.push(page);
      y = 660;
    };
    const addLines = (text, { size = 10, leading = 15, color = "0.09 0.16 0.14", bold = false } = {}) => {
      wrap(text).forEach((line) => {
        if (y < margin + leading) newPage();
        page.commands.push(`${color} rg BT /F${bold ? 2 : 1} ${size} Tf ${margin} ${y} Td (${safeText(line)}) Tj ET`);
        y -= leading;
      });
    };
    newPage();
    const point = payload?.point;
    const coordinates = point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : "Unknown location";
    const location = payload?.address?.address || coordinates;
    addLines(`Generated ${new Date().toLocaleString()}`, { size: 9, leading: 14, color: "0.36 0.44 0.41" });
    y -= 10;
    addLines("Location", { size: 13, leading: 18, color: "0.08 0.36 0.30", bold: true });
    addLines(location, { size: 12, leading: 18, bold: true });
    addLines(`Coordinates: ${coordinates}`);
    const extent = this.mapController.getCurrentExtentDetails?.();
    if (extent) addLines(`Map extent: ${extent.west.toFixed(4)}, ${extent.south.toFixed(4)} to ${extent.east.toFixed(4)}, ${extent.north.toFixed(4)}${extent.zoom != null ? ` (zoom ${extent.zoom})` : ""}`);
    if (hasAIResponse) {
      y -= 10;
      addLines("Query", { size: 13, leading: 18, color: "0.08 0.36 0.30", bold: true });
      addLines(this.lastAIQueryText || "Map context query", { size: 11, leading: 16 });
      y -= 10;
      addLines("Generated intelligence", { size: 13, leading: 18, color: "0.08 0.36 0.30", bold: true });
      addLines(markdownToPlainText(this.lastAIResponseText), { size: 10, leading: 15 });
    } else {
      const reportResults = payload.selectedResults?.length ? payload.selectedResults : (payload.results ?? []).slice(0, 1);
      y -= 10;
      addLines("Map Insight attributes", { size: 13, leading: 18, color: "0.08 0.36 0.30", bold: true });
      if (!reportResults.length) {
        addLines("No map feature was identified at the clicked location.");
      } else {
        reportResults.forEach((result) => {
          addLines(result.layerTitle || "Selected feature", { size: 11, leading: 16, bold: true });
          const attributes = Object.entries(result.attributes ?? {}).filter(([, value]) => value !== null && value !== "");
          if (!attributes.length) addLines("No attributes returned.");
          attributes.slice(0, 60).forEach(([key, value]) => {
            addLines(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`, { size: 10, leading: 15 });
          });
          if (attributes.length > 60) addLines(`… ${attributes.length - 60} additional attributes omitted.`, { size: 9, leading: 14, color: "0.36 0.44 0.41" });
          y -= 6;
        });
      }
    }
    if (mapImage) {
      newPage();
      addLines("Map snapshot", { size: 13, leading: 18, color: "0.08 0.36 0.30", bold: true });
      addLines("The map view at the time this Location Intelligence Report was created.", { size: 9, leading: 14, color: "0.36 0.44 0.41" });
      const imageWidth = pageWidth - (margin * 2);
      const imageHeight = Math.min(360, imageWidth * (mapImage.height / mapImage.width));
      const imageName = "ImMap";
      page.images.push({ name: imageName, asset: mapImage });
      page.commands.push(`q ${imageWidth} 0 0 ${imageHeight} ${margin} ${y - imageHeight} cm /${imageName} Do Q`);
      y -= imageHeight + 18;
      addLines(`Map extent: ${this.mapController.getCurrentExtentDetails()?.west.toFixed(4)}, ${this.mapController.getCurrentExtentDetails()?.south.toFixed(4)} to ${this.mapController.getCurrentExtentDetails()?.east.toFixed(4)}, ${this.mapController.getCurrentExtentDetails()?.north.toFixed(4)}`, { size: 9, leading: 14, color: "0.36 0.44 0.41" });
    }
    const objects = [null];
    const reserve = () => { objects.push(""); return objects.length - 1; };
    const setObject = (id, value) => { objects[id] = value; };
    const catalogId = reserve();
    const pagesId = reserve();
    const regularFontId = reserve();
    const boldFontId = reserve();
    setObject(regularFontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
    setObject(boldFontId, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
    const imageIds = new Map();
    const imageObject = (asset) => {
      if (imageIds.has(asset)) return imageIds.get(asset);
      const imageId = reserve();
      const header = textEncoder.encode(`<< /Type /XObject /Subtype /Image /Width ${asset.width} /Height ${asset.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${asset.bytes.length} >>\nstream\n`);
      const footer = textEncoder.encode("\nendstream");
      const bytes = new Uint8Array(header.length + asset.bytes.length + footer.length);
      bytes.set(header);
      bytes.set(asset.bytes, header.length);
      bytes.set(footer, header.length + asset.bytes.length);
      setObject(imageId, bytes);
      imageIds.set(asset, imageId);
      return imageId;
    };
    const pageIds = pages.map((currentPage) => {
      const stream = currentPage.commands.join("\n");
      const contentId = reserve();
      setObject(contentId, `<< /Length ${textEncoder.encode(stream).length} >>\nstream\n${stream}\nendstream`);
      const pageId = reserve();
      const xObjects = currentPage.images.map(({ name, asset }) => `/${name} ${imageObject(asset)} 0 R`).join(" ");
      setObject(pageId, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 ${regularFontId} 0 R /F2 ${boldFontId} 0 R >>${xObjects ? ` /XObject << ${xObjects} >>` : ""} >> /Contents ${contentId} 0 R >>`);
      return pageId;
    });
    setObject(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    setObject(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    const chunks = [textEncoder.encode("%PDF-1.4\n%????\n")];
    let length = chunks[0].length;
    const offsets = [0];
    objects.slice(1).forEach((object, index) => {
      offsets[index + 1] = length;
      const head = textEncoder.encode(`${index + 1} 0 obj\n`);
      const body = typeof object === "string" ? textEncoder.encode(object) : object;
      const tail = textEncoder.encode("\nendobj\n");
      chunks.push(head, body, tail);
      length += head.length + body.length + tail.length;
    });
    const xrefOffset = length;
    chunks.push(textEncoder.encode(`xref\n0 ${objects.length}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`));
    const slug = String(location).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48) || "map-location";
    const download = document.createElement("a");
    download.href = URL.createObjectURL(new Blob(chunks, { type: "application/pdf" }));
    download.download = `location-intelligence-report-${slug}.pdf`;
    download.click();
    setTimeout(() => URL.revokeObjectURL(download.href), 1000);
    this.toast(hasAIResponse ? "Location Intelligence Report downloaded." : "Location report downloaded.");
  }

  #showProject(project, state = "Local") {
    document.querySelector("#project-name").textContent = project.name;
    document.querySelector("#save-state").textContent = state;
  }

  openDialog({ eyebrow = "GIS Map Online", title, content, actions = [] }) {
    this.dialog.classList.remove("app-dialog--docked");
    document.querySelector("#dialog-dock").setAttribute("aria-label", "Move dialog to the right panel");
    document.querySelector("#dialog-dock").textContent = "↗";
    document.querySelector("#dialog-eyebrow").textContent = eyebrow;
    document.querySelector("#dialog-title").textContent = title;
    document.querySelector("#dialog-content").innerHTML = content;
    const footer = document.querySelector("#dialog-actions");
    footer.innerHTML = "";
    actions.forEach((action) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = action.label;
      if (action.primary) button.className = "button--primary";
      button.addEventListener("click", action.handler);
      footer.append(button);
    });
    if (!this.dialog.open) this.dialog.showModal();
  }

  toast(message) {
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.textContent = message;
    document.querySelector("#toast-region").append(toast);
    setTimeout(() => toast.remove(), 4500);
  }

  error(message) {
    const toast = document.createElement("div");
    toast.className = "toast toast--error";
    toast.textContent = message;
    document.querySelector("#toast-region").append(toast);
    setTimeout(() => toast.remove(), 7000);
  }

  #closeMenus() {
    document.body.classList.remove("mobile-menu-open");
    document.querySelector("#mobile-menu-toggle").classList.remove("is-active");
    document.querySelectorAll(".menu.is-open").forEach((menu) => menu.classList.remove("is-open"));
    document.querySelectorAll(".menu__trigger").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    document.querySelectorAll(".menu-bar.is-consolidated-open").forEach((menu) => menu.classList.remove("is-consolidated-open"));
    document.querySelectorAll(".menu-bar__all-trigger").forEach((trigger) => trigger.setAttribute("aria-expanded", "false"));
    const drawer = document.querySelector("#mobile-menu-drawer");
    if (drawer && !drawer.hidden) {
      drawer.hidden = true;
      const toggle = document.querySelector("#mobile-menu-toggle");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open application menu");
    }
  }
}
