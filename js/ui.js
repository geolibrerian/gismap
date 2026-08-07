import { POPULAR_SERVICES } from "./catalog.js";
import { ENTERPRISE_CATALOGS, EnterpriseCatalog } from "./enterprise-catalog.js";

const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[char]);

export class UIController {
  constructor(events, mapController, projectManager, aiController, toolManager) {
    Object.assign(this, { events, mapController, projectManager, aiController, toolManager });
    this.dialog = document.querySelector("#app-dialog");
    this.searchResults = [];
    this.lastInsight = null;
  }

  initialize() {
    if (matchMedia("(max-width: 640px)").matches) this.#setSidebarCollapsed(true);
    this.#bindMenus();
    this.#bindStaticActions();
    this.#bindMapEvents();
    this.#renderBookmarks();
    this.#renderLayers();
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
    document.querySelector("#insights-close").addEventListener("click", () => {
      document.querySelector("#insights-overlay").hidden = true;
    });
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
    this.events.subscribe("project:exported", ({ kind }) => this.toast(`${kind === "package" ? "Project package" : "Project JSON"} downloaded.`));
    this.events.subscribe("bookmarks:changed", () => this.#renderBookmarks());
    this.events.subscribe("identify:start", () => {
      document.querySelector("#insights-overlay").hidden = true;
      document.querySelector("#intelligence-content").innerHTML = '<div class="loading-row"><span></span> Inspecting location…</div>';
    });
    this.events.subscribe("identify:complete", (payload) => this.#renderInsight(payload));
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
    this.events.subscribe("app:error", ({ message }) => this.error(message));
  }

  #setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    document.querySelector("#sidebar").setAttribute("aria-hidden", String(collapsed));
    document.querySelector("#sidebar-open").setAttribute("aria-expanded", String(!collapsed));
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
        case "tools-ai":
          this.#aiDialog();
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
        <p class="form-note">${isGeoJson ? "The URL must return RFC 7946 GeoJSON and allow browser requests through CORS. It will load as a native ArcGIS GeoJSONLayer with querying, styling, tables, and refresh support." : "The remote server must allow cross-origin browser requests (CORS). Secured services may require a token or configured portal."}</p>`,
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

  #aiDialog() {
    const config = this.aiController.config ?? {};
    const provider = config.provider || "ollama";
    const defaults = {
      ollama: ["http://localhost:11434", "llama3.2"],
      openai: ["https://api.openai.com/v1", "gpt-5-mini"],
      anthropic: ["https://api.anthropic.com/v1", "claude-sonnet-5"],
      "openai-compatible": ["", ""],
    };
    const actions = [];
    if (config.provider) {
      actions.push({ label: "Disable AI", handler: () => {
        this.aiController.disable();
        this.dialog.close();
        this.toast("AI intelligence disabled.");
      }});
    }
    actions.push({ label: "Use for this tab", primary: true, handler: () => {
      try {
        this.aiController.configure({
          provider: this.dialog.querySelector("#ai-provider").value,
          endpoint: this.dialog.querySelector("#ai-endpoint").value,
          model: this.dialog.querySelector("#ai-model").value,
          token: this.dialog.querySelector("#ai-token").value,
        });
        this.dialog.close();
        this.toast("AI enabled for this tab.");
      } catch (error) {
        this.error(error.message);
      }
    }});
    this.openDialog({
      eyebrow: "AI adapter",
      title: "Configure intelligence provider",
      content: `<label class="field"><span>Provider</span><select id="ai-provider"><option value="ollama" ${provider === "ollama" ? "selected" : ""}>Ollama (local)</option><option value="openai" ${provider === "openai" ? "selected" : ""}>OpenAI</option><option value="anthropic" ${provider === "anthropic" ? "selected" : ""}>Anthropic Claude</option><option value="openai-compatible" ${provider === "openai-compatible" ? "selected" : ""}>OpenAI-compatible endpoint</option></select></label>
        <label class="field"><span>Endpoint</span><input id="ai-endpoint" type="url" value="${escapeHtml(config.endpoint || defaults[provider][0])}" /></label>
        <label class="field"><span>Model</span><input id="ai-model" value="${escapeHtml(config.model || defaults[provider][1])}" /></label>
        <label class="field"><span>API token <small>online providers only</small></span><input id="ai-token" type="password" autocomplete="off" /></label>
        <p class="form-note">Provider, endpoint, and model may be remembered locally. API tokens remain only in page memory and are never saved or exported; re-enter them after a reload. Direct browser keys are appropriate only for personal testing. Use a controlled proxy for a public paid service. Ollama must allow this site's origin.</p>`,
      actions,
    });
    const providerInput = this.dialog.querySelector("#ai-provider");
    providerInput.addEventListener("change", () => {
      const [endpoint, model] = defaults[providerInput.value];
      this.dialog.querySelector("#ai-endpoint").value = endpoint;
      this.dialog.querySelector("#ai-model").value = model;
    });
  }

  #aboutDialog() {
    this.openDialog({
      eyebrow: "Foundation build",
      title: "GIS Map Online",
      content: `<div class="about-copy"><p>A browser-only GIS viewer built around ArcGIS Maps SDK for JavaScript 5.0 and a topic-based event bus.</p><dl><div><dt>Runtime</dt><dd>Static HTML + ES modules</dd></div><div><dt>Persistence</dt><dd>localStorage + portable ZIP</dd></div><div><dt>Identify</dt><dd>Popup-free normalized results</dd></div><div><dt>Privacy</dt><dd>No application login or database</dd></div></dl></div>`,
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
          <div class="layer-card__head"><label class="layer-toggle"><input type="checkbox" data-layer-visible ${layer.visible ? "checked" : ""} /><span></span></label><div><strong title="${escapeHtml(layer.title)}">${escapeHtml(layer.title)}</strong><small>${escapeHtml(config.sourceType)}${config.refreshInterval ? ` · ${config.refreshInterval}m refresh` : ""}</small></div><button data-layer-action="remove" title="Remove layer">×</button></div>
          <label class="opacity-row"><span>Opacity</span><input data-layer-opacity type="range" min="0" max="1" step="0.05" value="${layer.opacity}" /><output>${Math.round(layer.opacity * 100)}%</output></label>
          <div class="layer-card__actions"><button data-layer-action="zoom">Zoom</button><button data-layer-action="table">Table</button><button data-layer-action="style">Style</button><button data-layer-action="refresh">Refresh</button></div>
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
        case "style": this.#symbologyDialog(uid); break;
        case "refresh": this.#refreshDialog(uid); break;
      }
    }));
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
    const resultHtml = results.slice(0, 12).map((result, index) => {
        const entries = Object.entries(result.attributes ?? {}).filter(([, value]) => value !== null && value !== "").slice(0, 12);
        return `<details class="result-card" ${index === 0 ? "open" : ""}><summary><span>${escapeHtml(result.layerTitle)}</span><small>${escapeHtml(result.kind)}</small></summary><dl>${entries.map(([key, value]) => `<div><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(typeof value === "object" ? JSON.stringify(value) : value)}</dd></div>`).join("") || "<div><dd>No attributes returned.</dd></div>"}</dl></details>`;
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
      document.querySelector("#insights-content").innerHTML = resultHtml;
      overlay.hidden = false;
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
  }
}
