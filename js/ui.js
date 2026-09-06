import { POPULAR_SERVICES } from "./catalog.js?v=0.10.1";
import { ENTERPRISE_CATALOGS, EnterpriseCatalog, normalizeArcGisDirectoryUrl } from "./enterprise-catalog.js?v=0.10.1";
import { createShareUrl } from "./share.js?v=0.10.1";
import { renderMarkdown } from "./markdown.js?v=0.10.1";

const DISPLAY_SETTINGS_KEY = "gismap-online:display:v1";
const WELCOME_DISMISSED_KEY = "gismap-online:welcome-dismissed:v1";
const INSIGHT_POSITIONS = new Set(["upper-left", "lower-left", "bottom", "dock-left", "dock-right", "dock-bottom"]);
const TABLE_POSITIONS = new Set(["overlay-bottom", "dock-left", "dock-right", "dock-bottom"]);
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
  constructor(events, mapController, projectManager, authController, aiController, toolManager, exportController) {
    Object.assign(this, { events, mapController, projectManager, authController, aiController, toolManager, exportController });
    this.dialog = document.querySelector("#app-dialog");
    this.searchResults = [];
    this.searchTimer = null;
    this.searchRequestId = 0;
    this.searchSelection = -1;
    this.lastInsight = null;
    this.systemThemeMedia = matchMedia("(prefers-color-scheme: dark)");
  }

  initialize() {
    this.#applyDisplaySettings(this.#readDisplaySettings());
    this.systemThemeMedia.addEventListener?.("change", () => {
      const settings = this.#readDisplaySettings();
      if (settings.appearance === "system") this.#applyDisplaySettings(settings);
    });
    if (matchMedia("(max-width: 640px)").matches) this.#setSidebarCollapsed(true);
    this.#buildMobileMenu();
    this.#bindMenus();
    this.#bindStaticActions();
    this.#bindInsightResize();
    this.#bindUtilityPanel();
    this.#bindMapEvents();
    this.#renderBookmarks();
    this.#renderLayers();
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
    const welcomePanel = document.querySelector("#welcome-panel");
    if (sessionStorage.getItem(WELCOME_DISMISSED_KEY) === "true") welcomePanel.dataset.dismissed = "true";
    document.querySelector("#welcome-close").addEventListener("click", () => {
      welcomePanel.dataset.dismissed = "true";
      welcomePanel.hidden = true;
      sessionStorage.setItem(WELCOME_DISMISSED_KEY, "true");
    });
    document.querySelectorAll("[data-action]").forEach((button) =>
      button.addEventListener("click", () => {
        if (button.closest("#welcome-panel")) {
          welcomePanel.dataset.dismissed = "true";
          welcomePanel.hidden = true;
          sessionStorage.setItem(WELCOME_DISMISSED_KEY, "true");
        }
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
    document.querySelectorAll("[data-draw]").forEach((button) =>
      button.addEventListener("click", () => this.mapController.draw(button.dataset.draw)),
    );
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
    document.querySelector("#mobile-menu-toggle").addEventListener("click", (event) => {
      event.stopPropagation();
      const drawer = document.querySelector("#mobile-menu-drawer");
      const opening = drawer.hidden;
      drawer.hidden = !opening;
      event.currentTarget.setAttribute("aria-expanded", String(opening));
      event.currentTarget.setAttribute("aria-label", `${opening ? "Close" : "Open"} application menu`);
      if (!opening) this.#closeMenus();
    });
    document.querySelectorAll("[data-mobile-panel]").forEach((button) =>
      button.addEventListener("click", () => this.#activateMobilePanel(button.dataset.mobilePanel)),
    );
    document.querySelector("#mobile-panel-close").addEventListener("click", () => this.#setSidebarCollapsed(true));
    document.querySelector("#utility-close").addEventListener("click", () => {
      if (this.mapController.widgets.has("basemapGallery")) void this.mapController.toggleWidget("basemapGallery");
    });
    this.#activateMobilePanel("places-panel", false);
    document.querySelector("#insights-close").addEventListener("click", () => {
      this.mapController.clearFeatureHighlight();
      this.#setInsightsOpen(false);
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
    this.dialog.addEventListener("close", () => this.exportController.cancel());
    document.querySelector("#project-file-input").addEventListener("change", (event) => this.#importProject(event));
    document.querySelector("#data-file-input").addEventListener("change", (event) => this.#addFiles(event));
    document.querySelector("#tool-file-input").addEventListener("change", (event) => this.#loadTool(event));
  }

  #bindMapEvents() {
    this.events.subscribe("map:ready", ({ view }) => {
      document.querySelector("#map-status").textContent = `Ready · zoom ${view.zoom.toFixed(1)}`;
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
      this.#showProject(project);
      this.#renderBookmarks();
      this.#renderLayers();
      if (missingFiles?.length) {
        this.error(`Reattach local file${missingFiles.length === 1 ? "" : "s"}: ${missingFiles.join(", ")}`);
      }
    });
    this.events.subscribe("project:saved", ({ project }) => {
      this.#showProject(project, "Saved");
      this.toast("Project saved in this browser.");
    });
    this.events.subscribe("project:exported", ({ kind }) => this.toast(`${kind === "package" ? "Project package (.gmop)" : "Project file (.gmo)"} downloaded.`));
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
      document.querySelector("#intelligence-content").innerHTML = '<div class="loading-row"><span></span> Inspecting location…</div>';
    });
    this.events.subscribe("identify:complete", (payload) => this.#renderInsight(payload));
    this.events.subscribe("table:open", () => {
      this.mapController.clearFeatureHighlight();
      this.#setInsightsOpen(false);
    });
    this.events.subscribe("identify:error", ({ error }) => {
      document.querySelector("#insights-overlay").setAttribute("aria-busy", "false");
      this.error(`Identify failed: ${error.message}`);
    });
    this.events.subscribe("ai:start", () => this.toast("Asking the configured model…"));
    this.events.subscribe("ai:complete", ({ text }) => this.#showAIResponse(text));
    this.events.subscribe("ai:error", ({ error }) => this.error(error.message));
    ["ai:configured", "ai:disabled"].forEach((topic) =>
      this.events.subscribe(topic, () => {
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
      if (name !== "basemapGallery") return;
      document.body.classList.toggle("utility-panel-open", open);
      document.querySelector("#utility-panel").setAttribute("aria-hidden", String(!open));
      document.querySelector("#utility-title").textContent = "Basemap gallery";
      requestAnimationFrame(() => this.mapController.resize());
    });
  }

  #setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    document.querySelector("#sidebar").setAttribute("aria-hidden", String(collapsed));
    document.querySelector("#sidebar-open").setAttribute("aria-expanded", String(!collapsed));
  }

  #activateMobilePanel(panelId, openSidebar = true) {
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
    if (openSidebar) this.#setSidebarCollapsed(false);
  }

  async #handleAction(action) {
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
      };
    } catch {
      return { insightPosition: "upper-left", defaultBasemap: "topo-3d", insightDockWidth: 420, insightDockHeight: 360, tablePosition: "overlay-bottom", tableDockWidth: 520, tableDockHeight: 420, highlightEnabled: true, clickMarkerEnabled: true, highlightColor: "#00b8d9", navigationLayout: "side", utilityPanelWidth: 360, appearance: "system", darkBasemapEnabled: false };
    }
  }

  #applyDisplaySettings(settings) {
    const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
    const resolvedTheme = settings.appearance === "system" ? (prefersDark ? "dark" : "light") : settings.appearance;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.style.colorScheme = resolvedTheme;
    document.body.classList.toggle("calcite-mode-dark", resolvedTheme === "dark");
    document.body.dataset.insightsPosition = settings.insightPosition;
    document.body.style.setProperty("--insights-dock-width", `${settings.insightDockWidth ?? 420}px`);
    document.body.style.setProperty("--insights-dock-height", `${settings.insightDockHeight ?? 360}px`);
    document.body.dataset.tablePosition = settings.tablePosition ?? "overlay-bottom";
    document.body.dataset.navigationLayout = settings.navigationLayout ?? "side";
    if (settings.navigationLayout === "top") {
      document.querySelectorAll(".sidebar__scroll > .panel").forEach((panel) => { panel.open = false; });
    }
    document.body.style.setProperty("--table-dock-width", `${settings.tableDockWidth ?? 520}px`);
    document.body.style.setProperty("--table-dock-height", `${settings.tableDockHeight ?? 420}px`);
    document.body.style.setProperty("--utility-panel-width", `${settings.utilityPanelWidth ?? 360}px`);
    const resizer = document.querySelector("#insights-resizer");
    if (resizer) resizer.setAttribute("aria-orientation", settings.insightPosition === "dock-bottom" ? "horizontal" : "vertical");
    const tableResizer = document.querySelector("#table-resizer");
    if (tableResizer) tableResizer.setAttribute("aria-orientation", settings.tablePosition === "dock-bottom" ? "horizontal" : "vertical");
    this.mapController.setDefaultBasemap(settings.defaultBasemap);
    if (settings.darkBasemapEnabled) {
      this.mapController.setBasemap(resolvedTheme === "dark" ? "navigation-dark-3d" : settings.defaultBasemap);
    }
    this.mapController.configureInteractionFeedback(settings);
    requestAnimationFrame(() => this.mapController.resize());
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
        <label class="field"><span>Map Insight position</span><select id="insight-position"><optgroup label="Floating"><option value="upper-left">Upper left</option><option value="lower-left">Lower left</option><option value="bottom">Bottom overlay</option></optgroup><optgroup label="Dashboard"><option value="dock-left">Dock left</option><option value="dock-right">Dock right</option><option value="dock-bottom">Dock bottom</option></optgroup></select></label>
        <label class="field"><span>Attribute table position</span><select id="table-position"><option value="overlay-bottom">Bottom overlay</option><option value="dock-left">Dock left</option><option value="dock-right">Dock right</option><option value="dock-bottom">Dock bottom</option></select></label>
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
      if (settings.insightPosition === "dock-bottom") {
        settings.insightDockHeight = Math.min(window.innerHeight * 0.65, Math.max(220, settings.insightDockHeight + amount));
      } else if (["dock-left", "dock-right"].includes(settings.insightPosition)) {
        settings.insightDockWidth = Math.min(window.innerWidth * 0.55, Math.max(300, settings.insightDockWidth + amount));
      } else return;
      localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
      this.#applyDisplaySettings(settings);
    };
    handle.addEventListener("keydown", (event) => {
      const position = document.body.dataset.insightsPosition;
      const direction = position === "dock-bottom"
        ? ({ ArrowUp: 16, ArrowDown: -16 })[event.key]
        : ({ ArrowLeft: position === "dock-right" ? 16 : -16, ArrowRight: position === "dock-right" ? -16 : 16 })[event.key];
      if (direction == null) return;
      event.preventDefault();
      resizeBy(direction);
    });
    handle.addEventListener("pointerdown", (event) => {
      const position = document.body.dataset.insightsPosition;
      if (!["dock-left", "dock-right", "dock-bottom"].includes(position)) return;
      event.preventDefault();
      const settings = this.#readDisplaySettings();
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = settings.insightDockWidth;
      const startHeight = settings.insightDockHeight;
      document.body.classList.add("insights-resizing");
      const move = (moveEvent) => {
        if (position === "dock-bottom") {
          settings.insightDockHeight = Math.min(window.innerHeight * 0.65, Math.max(220, startHeight + startY - moveEvent.clientY));
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
          if (layer.fullExtent) await this.mapController.goToLayer(layer).catch(() => {});
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
      content: `<p class="form-note">This service contains multiple layers. Add the datasets you want individually.</p>
        <div class="enterprise-list">${layers.map((layer) => `<div class="enterprise-row">
          <span><strong>${escapeHtml(layer.name)}</strong><small>${escapeHtml(layer.geometryType)} · Layer ${layer.id}</small></span>
          <button type="button" data-feature-service-layer="${escapeHtml(layer.url)}">Add</button>
        </div>`).join("")}</div>`,
    });
    this.dialog.querySelectorAll("[data-feature-service-layer]").forEach((button) =>
      button.addEventListener("click", async () => {
        button.disabled = true;
        button.textContent = "Adding…";
        try {
          const layerInfo = layers.find((item) => item.url === button.dataset.featureServiceLayer);
          const layer = await this.mapController.addService({
            ...config,
            url: layerInfo.url,
            title: layerInfo.name,
            serviceType: "feature",
          });
          button.textContent = "Added";
          this.toast(`${layer.title} added.`);
          if (layer.fullExtent) await this.mapController.goToLayer(layer).catch(() => {});
        } catch (error) {
          button.disabled = false;
          button.textContent = "Add";
          this.error(error.message);
        }
      }),
    );
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
              if (layer.fullExtent) await this.mapController.goToLayer(layer).catch(() => {});
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
      openai: ["https://api.openai.com/v1", "gpt-5-mini"],
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
    const testOllama = async () => {
      const pending = readForm();
      if (pending.provider !== "ollama") {
        throw new Error("The connection test is for local Ollama. Online providers are checked when enabled.");
      }
      setConnectionStatus("testing", "Checking Ollama and installed models…");
      try {
        const result = await this.aiController.testConnection(pending);
        this.dialog.querySelector("#ollama-models").innerHTML = result.models
          .map((name) => `<option value="${escapeHtml(name)}"></option>`)
          .join("");
        setConnectionStatus(
          "success",
          `Connected. ${result.models.length} installed model${result.models.length === 1 ? "" : "s"} found.`,
        );
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
    actions.push({ label: "Test Ollama", handler: async () => {
      try {
        await testOllama();
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
        if (pending.provider === "ollama") await testOllama();
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
        <label class="field"><span>Model</span><input id="ai-model" list="ollama-models" value="${escapeHtml(config.model || defaults[provider][1])}" /><datalist id="ollama-models"></datalist><small>Use the complete Ollama tag, including a suffix such as <code>:27b</code>.</small></label>
        <label class="field"><span>API token <small>online providers only</small></span><input id="ai-token" type="password" autocomplete="off" /></label>
        <section id="ollama-setup" class="ollama-setup" ${provider === "ollama" ? "" : "hidden"}>
          <strong>One-time Ollama browser access on macOS</strong>
          <p>Ollama must allow this exact site origin. Run this in Terminal:</p>
          <code>launchctl setenv OLLAMA_ORIGINS &quot;${escapeHtml(appOrigin)}&quot;</code>
          <p>Then fully quit Ollama from its menu-bar icon, reopen it, and choose <b>Test Ollama</b>.</p>
          <small>Keeping the permission scoped to ${escapeHtml(appOrigin)} is safer than using <code>*</code>. Ollama's local API has no authentication.</small>
        </section>
        <div id="ai-connection-status" class="connection-status" hidden></div>
        <p class="form-note">Provider, endpoint, and model may be remembered locally. API tokens remain only in page memory and are never saved or exported; re-enter them after a reload. Direct browser keys are appropriate only for personal testing. Use a controlled proxy for a public paid service.</p>`,
      actions,
    });
    const providerInput = this.dialog.querySelector("#ai-provider");
    providerInput.addEventListener("change", () => {
      const [endpoint, model] = defaults[providerInput.value];
      this.dialog.querySelector("#ai-endpoint").value = endpoint;
      this.dialog.querySelector("#ai-model").value = model;
      this.dialog.querySelector("#ollama-setup").hidden = providerInput.value !== "ollama";
      this.dialog.querySelector("#ai-connection-status").hidden = true;
    });
  }

  #aboutDialog() {
    this.openDialog({
      eyebrow: "Foundation build",
      title: "GIS Map Online",
      content: `<div class="about-copy"><p>A browser-only GIS viewer built around ArcGIS Maps SDK for JavaScript 5.0 and a topic-based event bus.</p><p><a href="/examples/">Browse public GIS examples</a> or read the <a href="/arcgis-rest-service-viewer/">viewer guides</a>.</p><dl><div><dt>Runtime</dt><dd>Static HTML + ES modules</dd></div><div><dt>Persistence</dt><dd>localStorage + portable ZIP</dd></div><div><dt>Identify</dt><dd>Popup-free normalized results</dd></div><div><dt>Identity</dt><dd>Optional ArcGIS OAuth / token authentication managed by the Esri SDK</dd></div><div><dt>Privacy</dt><dd>No GIS Map Online account or database; credentials are excluded from projects</dd></div></dl></div>`,
    });
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
        if (layer.fullExtent) await this.mapController.goToLayer(layer).catch(() => {});
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

  #addBookmark() {
    const view = this.mapController.view;
    const name = document.querySelector("#place-query").value.trim() || `View at ${view.center.latitude.toFixed(3)}, ${view.center.longitude.toFixed(3)}`;
    this.projectManager.addBookmark({ name, viewpoint: this.mapController.getViewState() });
  }

  #renderBookmarks() {
    const bookmarks = this.projectManager.current.bookmarks ?? [];
    const container = document.querySelector("#bookmarks-list");
    container.classList.toggle("muted", !bookmarks.length);
    container.innerHTML = bookmarks.length
      ? bookmarks.map((bookmark) => `<div class="bookmark-row"><button data-bookmark-id="${escapeHtml(bookmark.id)}">${escapeHtml(bookmark.name)}</button><button data-bookmark-remove="${escapeHtml(bookmark.id)}" aria-label="Remove bookmark">×</button></div>`).join("")
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
  }

  #renderLayers() {
    const layers = this.mapController.getOperationalLayers().slice().reverse();
    const welcomePanel = document.querySelector("#welcome-panel");
    welcomePanel.hidden = welcomePanel.dataset.dismissed === "true";
    const exportable = new Set(this.exportController.listExportableLayers().map((layer) => layer.uid));
    document.querySelector("#layer-count").textContent = `${layers.length} loaded`;
    const container = document.querySelector("#layers-list");
    container.innerHTML = layers.length
      ? layers.map((layer) => {
        const config = this.mapController.getLayerConfig(layer);
        return `<article class="layer-card" data-layer-uid="${escapeHtml(layer.uid)}">
          <div class="layer-card__head"><label class="layer-toggle"><input type="checkbox" data-layer-visible ${layer.visible ? "checked" : ""} /><span></span></label><div><strong title="${escapeHtml(layer.title)}">${escapeHtml(layer.title)}</strong><small>${escapeHtml(config.sourceType)}${config.definitionExpression ? " · Filtered" : ""}${config.refreshInterval ? ` · ${config.refreshInterval}m refresh` : ""}</small></div><button data-layer-action="remove" title="Remove layer">×</button></div>
          <label class="opacity-row"><span>Opacity</span><input data-layer-opacity type="range" min="0" max="1" step="0.05" value="${layer.opacity}" /><output>${Math.round(layer.opacity * 100)}%</output></label>
          <div class="layer-card__actions"><button data-layer-action="zoom">Zoom</button><button data-layer-action="table">Table</button><button data-layer-action="filter">Filter</button><button data-layer-action="export" ${exportable.has(layer.uid) ? "" : "disabled title=\"This layer is not queryable\""}>Export</button><button data-layer-action="style">Style</button><button data-layer-action="refresh">Refresh</button></div>
        </article>`;
      }).join("")
      : '<div class="empty-state">Add a file or service from the Data menu.</div>';
    container.querySelectorAll(".layer-card").forEach((card) => this.#bindLayerCard(card));
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
        case "zoom": if (layer?.fullExtent) await this.mapController.goToLayer(layer); break;
        case "table": this.events.publish("table:open", { uid }); break;
        case "filter": await this.#filterDialog(uid); break;
        case "export": this.#exportDialog(uid); break;
        case "style": this.#symbologyDialog(uid); break;
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

  #symbologyDialog(uid) {
    const layer = this.mapController.findLayer(uid);
    this.openDialog({
      eyebrow: "Layer presentation",
      title: `Style ${layer?.title || "layer"}`,
      content: '<div class="field-grid"><label class="field"><span>Fill / marker / line</span><input id="symbol-color" type="color" value="#1b7f6a" /></label><label class="field"><span>Outline</span><input id="symbol-outline" type="color" value="#ffffff" /></label><label class="field"><span>Size / width</span><input id="symbol-size" type="number" min="0.5" max="40" step="0.5" value="9" /></label></div><p class="form-note">This first pass applies a simple renderer. Its JSON is stored with the project.</p>',
      actions: [{ label: "Apply symbology", primary: true, handler: async () => {
        try {
          await this.mapController.setSimpleSymbology(uid, {
            color: this.dialog.querySelector("#symbol-color").value,
            outline: this.dialog.querySelector("#symbol-outline").value,
            size: this.dialog.querySelector("#symbol-size").value,
          });
          this.dialog.close();
        } catch (error) { this.error(error.message); }
      }}],
    });
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
    const point = payload.point;
    const coord = point ? `${point.latitude.toFixed(6)}, ${point.longitude.toFixed(6)}` : "Unknown location";
    const results = payload.results ?? [];
    const visibleResults = results.slice(0, 12);
    const tabsHtml = visibleResults.length > 1
      ? `<div class="insight-tabs" role="tablist" aria-label="Identified features">${visibleResults.map((result, index) =>
          `<button type="button" role="tab" id="insight-tab-${index}" data-insight-tab="${index}" aria-controls="insight-panel-${index}" aria-selected="${index === 0}">${escapeHtml(result.layerTitle)} ${index + 1}</button>`,
        ).join("")}</div>`
      : "";
    const resultHtml = visibleResults.map((result, index) => {
        const entries = Object.entries(result.attributes ?? {}).filter(([, value]) => value !== null && value !== "");
        return `<article class="insight-panel" id="insight-panel-${index}" role="tabpanel" aria-labelledby="insight-tab-${index}" ${index === 0 ? "" : "hidden"}><header><strong>${escapeHtml(result.layerTitle)}</strong><small>${escapeHtml(result.kind)}</small></header><dl>${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</dd></div>`).join("") || "<div><dd>No attributes returned.</dd></div>"}</dl></article>`;
      }).join("");
    const aiForm = this.aiController.isConfigured()
      ? '<form id="ai-question" class="ai-question"><label for="ai-prompt">Ask about this map context</label><div><input id="ai-prompt" placeholder="What stands out here?" /><button>Ask AI</button></div></form>'
      : "";
    const html = `<div class="location-card"><span class="eyebrow">Location</span><strong>${escapeHtml(payload.address?.address || coord)}</strong><small>${escapeHtml(coord)}</small></div>${aiForm}`;
    document.querySelector("#intelligence-content").classList.remove("intelligence-empty");
    document.querySelector("#intelligence-content").innerHTML = html;
    const overlay = document.querySelector("#insights-overlay");
    overlay.setAttribute("aria-busy", "false");
    if (results.length) {
      document.querySelector("#insights-title").textContent =
        results.length === 1 ? results[0].layerTitle : `${results.length} features`;
      document.querySelector("#insights-content").innerHTML = `${tabsHtml}${resultHtml}`;
      this.#setInsightsOpen(true);
      document.querySelectorAll("[data-insight-tab]").forEach((button) =>
        button.addEventListener("click", () => this.#activateInsightTab(Number(button.dataset.insightTab))),
      );
      void this.mapController.highlightFeature(visibleResults[0], { pulse: false });
    } else {
      this.mapController.clearFeatureHighlight();
      document.querySelector("#insights-content").replaceChildren();
      this.#setInsightsOpen(false);
    }
    document.querySelector("#ai-question")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const prompt = event.currentTarget.querySelector("input").value.trim();
      if (prompt) this.aiController.ask(prompt, payload).catch(() => {});
    });
  }

  #activateInsightTab(index) {
    document.querySelectorAll("[data-insight-tab]").forEach((button) => {
      const active = Number(button.dataset.insightTab) === index;
      button.setAttribute("aria-selected", String(active));
      button.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(".insight-panel").forEach((panel, panelIndex) => {
      panel.hidden = panelIndex !== index;
    });
    const result = this.lastInsight?.results?.slice(0, 12)[index];
    void this.mapController.highlightFeature(result, { pulse: true });
  }

  #showAIResponse(text) {
    const content = document.querySelector("#intelligence-content");
    const response = document.createElement("section");
    response.className = "ai-response";
    response.innerHTML = `<span class="eyebrow">AI context</span><div class="ai-response__markdown">${renderMarkdown(text)}</div>`;
    content.append(response);
    response.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  #showProject(project, state = "Local") {
    document.querySelector("#project-name").textContent = project.name;
    document.querySelector("#save-state").textContent = state;
  }

  openDialog({ eyebrow = "GIS Map Online", title, content, actions = [] }) {
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
