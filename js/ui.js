import { POPULAR_SERVICES } from "./catalog.js";
import { ENTERPRISE_CATALOGS, EnterpriseCatalog } from "./enterprise-catalog.js";

const DISPLAY_SETTINGS_KEY = "gismap-online:display:v1";
const INSIGHT_POSITIONS = new Set(["upper-left", "lower-left", "bottom"]);
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
  constructor(events, mapController, projectManager, authController, aiController, toolManager) {
    Object.assign(this, { events, mapController, projectManager, authController, aiController, toolManager });
    this.dialog = document.querySelector("#app-dialog");
    this.searchResults = [];
    this.lastInsight = null;
  }

  initialize() {
    this.#applyDisplaySettings(this.#readDisplaySettings());
    if (matchMedia("(max-width: 640px)").matches) this.#setSidebarCollapsed(true);
    this.#buildMobileMenu();
    this.#bindMenus();
    this.#bindStaticActions();
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
        const open = !menu.classList.contains("is-open");
        document.querySelectorAll(".menu.is-open").forEach((item) => item.classList.remove("is-open"));
        menu.classList.toggle("is-open", open);
        trigger.setAttribute("aria-expanded", String(open));
      });
    });
    document.addEventListener("click", () => {
      document.querySelectorAll(".menu.is-open").forEach((item) => item.classList.remove("is-open"));
      document.querySelectorAll(".menu__trigger").forEach((item) => item.setAttribute("aria-expanded", "false"));
    });
    document.querySelectorAll(".menu__content").forEach((menu) => menu.addEventListener("click", (e) => e.stopPropagation()));
  }

  #bindStaticActions() {
    document.querySelectorAll("[data-action]").forEach((button) =>
      button.addEventListener("click", () => {
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
    this.#activateMobilePanel("places-panel", false);
    document.querySelector("#insights-close").addEventListener("click", () => {
      document.querySelector("#insights-overlay").hidden = true;
    });
    document.querySelector("#insights-settings").addEventListener("click", () => this.#displaySettingsDialog());
    document.querySelector("#place-search").addEventListener("submit", (event) => this.#search(event));
    document.querySelector("#bookmark-add").addEventListener("click", () => this.#addBookmark());
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
    this.events.subscribe("bookmarks:changed", () => this.#renderBookmarks());
    this.events.subscribe("identify:start", () => {
      document.querySelector("#insights-overlay").hidden = true;
      document.querySelector("#intelligence-content").innerHTML = '<div class="loading-row"><span></span> Inspecting location…</div>';
    });
    this.events.subscribe("identify:complete", (payload) => this.#renderInsight(payload));
    this.events.subscribe("table:open", () => { document.querySelector("#insights-overlay").hidden = true; });
    this.events.subscribe("identify:error", ({ error }) => this.error(`Identify failed: ${error.message}`));
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

  #readDisplaySettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY)) ?? {};
      return {
        insightPosition: INSIGHT_POSITIONS.has(saved.insightPosition) ? saved.insightPosition : "upper-left",
        defaultBasemap: BASEMAP_IDS.has(saved.defaultBasemap) ? saved.defaultBasemap : "topo-3d",
      };
    } catch {
      return { insightPosition: "upper-left", defaultBasemap: "topo-3d" };
    }
  }

  #applyDisplaySettings(settings) {
    document.body.dataset.insightsPosition = settings.insightPosition;
    this.mapController.setDefaultBasemap(settings.defaultBasemap);
  }

  #displaySettingsDialog() {
    const { insightPosition } = this.#readDisplaySettings();
    const defaultBasemap = this.mapController.getDefaultBasemapId();
    const option = (value, title, description) => `<label class="display-choice"><input type="radio" name="insight-position" value="${value}" ${insightPosition === value ? "checked" : ""} /><span><strong>${title}</strong><small>${description}</small></span></label>`;
    const basemapOptions = BASEMAP_OPTIONS.map(([id, label]) => `<option value="${id}" ${defaultBasemap === id ? "selected" : ""}>${label}</option>`).join("");
    this.openDialog({
      eyebrow: "Interface preferences",
      title: "Display settings",
      content: `<fieldset class="display-choices"><legend>Map insight position</legend>${option("upper-left", "Upper left", "Default; keeps map navigation controls clear.")}${option("lower-left", "Lower left", "Anchors the window above the map status area.")}${option("bottom", "Bottom drawer", "Uses a wide panel similar to the attribute table.")}</fieldset><label class="field display-basemap"><span>Default basemap</span><select id="default-basemap">${basemapOptions}</select></label><p class="form-note">The default is used for new projects and included in saved project files. The current project's active basemap remains unchanged.</p>`,
      actions: [{ label: "Save settings", primary: true, handler: () => {
        const insightPosition = this.dialog.querySelector('input[name="insight-position"]:checked')?.value ?? "upper-left";
        const defaultBasemap = this.dialog.querySelector("#default-basemap").value;
        const settings = { insightPosition, defaultBasemap };
        localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
        this.#applyDisplaySettings(settings);
        this.dialog.close();
        this.toast("Display settings saved.");
      }}],
    });
  }

  #serviceDialog(serviceType) {
    const isWms = serviceType === "wms";
    const isGeoJson = serviceType === "geojson";
    const title = isWms ? "Add WMS service" : isGeoJson ? "Add GeoJSON URL / feed" : "Add ArcGIS REST service";
    const placeholder = isWms
      ? "https://server.example/geoserver/wms"
      : isGeoJson
        ? "https://example.org/data/feed.geojson"
        : "https://server.example/arcgis/rest/services/...";
    this.openDialog({
      eyebrow: isGeoJson ? "Open vector data feed" : isWms ? "Open geospatial service" : "ArcGIS Enterprise / Online",
      title,
      content: `<label class="field"><span>${isGeoJson ? "GeoJSON URL" : "Service URL"}</span><input id="service-url" type="url" placeholder="${placeholder}" /></label>
        <label class="field"><span>Layer title <small>optional</small></span><input id="service-title" /></label>
        ${isWms || isGeoJson ? "" : `<label class="field"><span>Service type</span><select id="service-type"><option value="arcgis-auto">Detect automatically</option><option value="feature">Feature service / layer</option><option value="map-image">Map service</option><option value="imagery">Image service</option></select></label>`}
        <label class="field"><span>Refresh every <small>minutes; 0 disables</small></span><input id="service-refresh" type="number" min="0" step="0.5" value="0" /></label>
        <p class="form-note">${isGeoJson ? "The URL must return RFC 7946 GeoJSON and allow browser requests through CORS. It will load as a native ArcGIS GeoJSONLayer with querying, styling, tables, and refresh support." : "Layer URLs and FeatureServer /query URLs are supported. Query URLs apply their where and outFields parameters; geometry is projected into the map automatically. The remote server must allow cross-origin browser requests (CORS)."}</p>`,
      actions: [{ label: isGeoJson ? "Add GeoJSON feed" : "Add service", primary: true, handler: async () => {
        const button = this.dialog.querySelector(".button--primary");
        button.disabled = true;
        button.textContent = "Adding…";
        try {
          const layer = await this.mapController.addService({
            url: this.dialog.querySelector("#service-url").value,
            title: this.dialog.querySelector("#service-title").value,
            serviceType: isWms ? "wms" : isGeoJson ? "geojson" : this.dialog.querySelector("#service-type").value,
            refreshInterval: Number(this.dialog.querySelector("#service-refresh").value),
          });
          this.dialog.close();
          this.toast(`${layer.title} added.`);
          if (layer.fullExtent) await this.mapController.goToLayer(layer).catch(() => {});
        } catch (error) {
          button.disabled = false;
          button.textContent = isGeoJson ? "Add GeoJSON feed" : "Add service";
          this.error(error.message);
        }
      }}],
    });
  }

  #popularDataDialog() {
    this.openDialog({
      eyebrow: "Starter catalog",
      title: "Popular data services",
      content: `<div class="catalog-list">${POPULAR_SERVICES.map((service) => `
        <article class="catalog-card">
          <div><span class="eyebrow">${escapeHtml(service.provider)}</span><h3>${escapeHtml(service.title)}</h3><p>${escapeHtml(service.description)}</p></div>
          <button data-catalog-id="${escapeHtml(service.id)}">Add</button>
        </article>`).join("")}</div><p class="form-note">Edit <code>js/catalog.js</code> to curate this list.</p>`,
    });
    this.dialog.querySelectorAll("[data-catalog-id]").forEach((button) =>
      button.addEventListener("click", async () => {
        const service = POPULAR_SERVICES.find((item) => item.id === button.dataset.catalogId);
        button.disabled = true;
        try {
          await this.mapController.addService(service);
          button.textContent = "Added";
          this.toast(`${service.title} added.`);
        } catch (error) {
          button.disabled = false;
          this.error(error.message);
        }
      }),
    );
  }

  async #enterpriseCatalogDialog(catalogId) {
    const definition = ENTERPRISE_CATALOGS.find((item) => item.id === catalogId);
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
    const connections = this.authController.list();
    const connectionCards = connections.length
      ? connections.map((connection) => {
          const url = connection.type === "portal" ? connection.portalUrl : connection.serverUrl;
          return `<article class="connection-card" data-connection-id="${escapeHtml(connection.id)}">
            <div class="connection-card__head">
              <div><strong>${escapeHtml(connection.name)}</strong><small>${connection.type === "portal" ? "Portal / ArcGIS Online OAuth" : "Standalone ArcGIS Server"}</small></div>
              <span class="connection-badge" data-connection-status>Checking…</span>
            </div>
            <code title="${escapeHtml(url)}">${escapeHtml(url)}</code>
            <div class="connection-card__actions">
              <button type="button" data-connect-id="${escapeHtml(connection.id)}">Connect</button>
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
              <label class="field"><span>Redirect URI to register in Portal</span><div class="copy-field"><input id="portal-callback-url" readonly value="${escapeHtml(callbackUrl)}" /><button type="button" id="copy-callback-url">Copy</button></div></label>
              <button type="button" id="add-portal-connection" class="inline-primary">Save &amp; connect</button>
              <p class="form-note">The organization administrator registers GIS Map Online once and supplies this public Client ID. Sign-in uses OAuth authorization code + PKCE when supported; no client secret belongs in this browser app.</p>
            </div>
          </details>

          <details class="connection-setup">
            <summary>Add standalone ArcGIS Server <small>secondary method</small></summary>
            <div class="connection-setup__body">
              <label class="field"><span>Connection name <small>optional</small></span><input id="server-connection-name" placeholder="Parcel server" /></label>
              <label class="field"><span>ArcGIS Server root URL</span><input id="server-connection-url" type="url" placeholder="https://gis.example.com/server" /></label>
              <label class="field"><span>Token service URL <small>defaults to /tokens/</small></span><input id="server-token-url" type="url" placeholder="https://gis.example.com/server/tokens/" /></label>
              <button type="button" id="add-server-connection" class="inline-primary">Register &amp; sign in</button>
              <p class="form-note">Use this only for a secured, non-federated ArcGIS Server. IdentityManager owns the credential challenge and token; GIS Map Online does not read or serialize the username, password, or token.</p>
            </div>
          </details>

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
    this.dialog.querySelector("#copy-callback-url").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(callbackUrl);
        this.toast("Redirect URI copied.");
      } catch {
        const input = this.dialog.querySelector("#portal-callback-url");
        input.select();
        this.toast("Redirect URI selected. Copy it from the field.");
      }
    });
    this.dialog.querySelector("#add-portal-connection").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, "Save & connect");
      try {
        const connection = this.authController.addPortal({
          name: this.dialog.querySelector("#portal-connection-name").value,
          portalUrl: this.dialog.querySelector("#portal-connection-url").value,
          clientId: this.dialog.querySelector("#portal-client-id").value,
        });
        await this.authController.connect(connection.id);
        this.#connectionsDialog();
      } catch (error) {
        setBusy(button, false, "Save & connect");
        this.error(error.message);
      }
    });
    this.dialog.querySelector("#add-server-connection").addEventListener("click", async (event) => {
      const button = event.currentTarget;
      setBusy(button, true, "Register & sign in");
      try {
        const connection = this.authController.addServer({
          name: this.dialog.querySelector("#server-connection-name").value,
          serverUrl: this.dialog.querySelector("#server-connection-url").value,
          tokenServiceUrl: this.dialog.querySelector("#server-token-url").value,
        });
        await this.authController.connect(connection.id);
        this.#connectionsDialog();
      } catch (error) {
        setBusy(button, false, "Register & sign in");
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
      content: `<div class="about-copy"><p>A browser-only GIS viewer built around ArcGIS Maps SDK for JavaScript 5.0 and a topic-based event bus.</p><dl><div><dt>Runtime</dt><dd>Static HTML + ES modules</dd></div><div><dt>Persistence</dt><dd>localStorage + portable ZIP</dd></div><div><dt>Identify</dt><dd>Popup-free normalized results</dd></div><div><dt>Identity</dt><dd>Optional ArcGIS OAuth / token authentication managed by the Esri SDK</dd></div><div><dt>Privacy</dt><dd>No GIS Map Online account or database; credentials are excluded from projects</dd></div></dl></div>`,
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
    const container = document.querySelector("#search-results");
    if (!input.value.trim()) return;
    container.innerHTML = '<div class="loading-row"><span></span> Searching…</div>';
    try {
      this.searchResults = await this.mapController.searchPlaces(input.value);
      container.innerHTML = this.searchResults.length
        ? this.searchResults.map((result, index) => `<button data-search-index="${index}">${escapeHtml(result.label)}</button>`).join("")
        : '<div class="empty-state">No matching places found.</div>';
      container.querySelectorAll("[data-search-index]").forEach((button) =>
        button.addEventListener("click", () => this.mapController.goToSearchResult(this.searchResults[button.dataset.searchIndex])),
      );
    } catch (error) {
      container.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
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
    document.querySelector("#layer-count").textContent = `${layers.length} loaded`;
    const container = document.querySelector("#layers-list");
    container.innerHTML = layers.length
      ? layers.map((layer) => {
        const config = this.mapController.getLayerConfig(layer);
        return `<article class="layer-card" data-layer-uid="${escapeHtml(layer.uid)}">
          <div class="layer-card__head"><label class="layer-toggle"><input type="checkbox" data-layer-visible ${layer.visible ? "checked" : ""} /><span></span></label><div><strong title="${escapeHtml(layer.title)}">${escapeHtml(layer.title)}</strong><small>${escapeHtml(config.sourceType)}${config.definitionExpression ? " · Filtered" : ""}${config.refreshInterval ? ` · ${config.refreshInterval}m refresh` : ""}</small></div><button data-layer-action="remove" title="Remove layer">×</button></div>
          <label class="opacity-row"><span>Opacity</span><input data-layer-opacity type="range" min="0" max="1" step="0.05" value="${layer.opacity}" /><output>${Math.round(layer.opacity * 100)}%</output></label>
          <div class="layer-card__actions"><button data-layer-action="zoom">Zoom</button><button data-layer-action="table">Table</button><button data-layer-action="filter">Filter</button><button data-layer-action="style">Style</button><button data-layer-action="refresh">Refresh</button></div>
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
    if (results.length) {
      document.querySelector("#insights-title").textContent =
        results.length === 1 ? results[0].layerTitle : `${results.length} features`;
      document.querySelector("#insights-content").innerHTML = `${tabsHtml}${resultHtml}`;
      overlay.hidden = false;
      document.querySelectorAll("[data-insight-tab]").forEach((button) =>
        button.addEventListener("click", () => this.#activateInsightTab(Number(button.dataset.insightTab))),
      );
    } else {
      document.querySelector("#insights-content").replaceChildren();
      overlay.hidden = true;
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
  }

  #showAIResponse(text) {
    const content = document.querySelector("#intelligence-content");
    const response = document.createElement("section");
    response.className = "ai-response";
    response.innerHTML = `<span class="eyebrow">AI context</span><p>${escapeHtml(text).replace(/\n/g, "<br>")}</p>`;
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
    const drawer = document.querySelector("#mobile-menu-drawer");
    if (drawer && !drawer.hidden) {
      drawer.hidden = true;
      const toggle = document.querySelector("#mobile-menu-toggle");
      toggle.setAttribute("aria-expanded", "false");
      toggle.setAttribute("aria-label", "Open application menu");
    }
  }
}
