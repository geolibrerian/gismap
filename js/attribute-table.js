const DISPLAY_SETTINGS_KEY = "gismap-online:display:v1";
const TABLE_POSITIONS = new Set(["overlay-bottom", "dock-left", "dock-right", "dock-bottom"]);

export class AttributeTableController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.dialog = document.querySelector("#table-dialog");
    this.state = {
      layer: null,
      rootUid: null,
      objectIds: [],
      usesObjectIds: true,
      total: 0,
      page: 0,
      pageSize: 25,
      where: "1=1",
      search: "",
    };
    this.visibleFeatures = [];
    this.operationId = 0;
  }

  initialize() {
    document.querySelector("#table-close").addEventListener("click", () => this.#cancelAndReset());
    this.dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      this.#cancelAndReset();
    });
    this.dialog.addEventListener("close", () => {
      document.body.classList.remove("table-open", "table-resizing");
      requestAnimationFrame(() => this.mapController.resize());
    });
    document.querySelector("#table-prev").addEventListener("click", () => this.goToPage(this.state.page - 1).catch((error) => this.#reportError(error)));
    document.querySelector("#table-next").addEventListener("click", () => this.goToPage(this.state.page + 1).catch((error) => this.#reportError(error)));
    document.querySelector("#table-search").addEventListener("submit", (event) => {
      event.preventDefault();
      this.#applySearch(document.querySelector("#table-search-input").value).catch((error) =>
        this.#reportError(error),
      );
    });
    document.querySelector("#table-search-clear").addEventListener("click", () => {
      document.querySelector("#table-search-input").value = "";
      this.#applySearch("").catch((error) =>
        this.#reportError(error),
      );
    });
    document.querySelector("#table-content").addEventListener("click", (event) => {
      const row = event.target.closest("tr[data-feature-index]");
      if (row) this.#zoomToFeature(Number(row.dataset.featureIndex));
    });
    document.querySelector("#table-content").addEventListener("keydown", (event) => {
      const row = event.target.closest("tr[data-feature-index]");
      if (row && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        this.#zoomToFeature(Number(row.dataset.featureIndex));
      }
    });
    this.#bindResize();
    this.events.subscribe("table:open", ({ uid }) => this.open(uid));
    this.events.subscribe("identify:start", () => this.#cancelAndReset());
    this.events.subscribe("layer:removed", ({ uid }) => {
      if (this.state.rootUid === uid) this.#cancelAndReset();
    });
    this.events.subscribe("layers:reset", () => this.#cancelAndReset());
  }

  async open(uid) {
    const operationId = ++this.operationId;
    this.#clearRenderedTable("Loading table…");
    try {
      let layer = this.mapController.findLayer(uid);
      layer = this.#firstQueryable(layer);
      if (!layer || typeof layer.queryFeatures !== "function") {
        throw new Error("This layer does not expose a queryable attribute table.");
      }
      await layer.load?.();
      if (operationId !== this.operationId) return;
      this.state = {
        ...this.state,
        layer,
        rootUid: uid,
        objectIds: [],
        page: 0,
        where: "1=1",
        search: "",
      };
      document.querySelector("#table-title").textContent = layer.title || layer.parent?.title || "Layer";
      document.querySelector("#table-search-input").value = "";
      document.querySelector("#table-search-clear").hidden = true;
      if (!this.dialog.open) this.dialog.show();
      document.body.classList.add("table-open");
      requestAnimationFrame(() => this.mapController.resize());
      if (!await this.#loadIndex(operationId)) return;
      await this.goToPage(0, operationId);
    } catch (error) {
      if (operationId !== this.operationId) return;
      this.#cancelAndReset();
      this.events.publish("app:error", { message: error.message });
    }
  }

  #firstQueryable(layer) {
    if (!layer) return null;
    if (typeof layer.queryFeatures === "function") return layer;
    for (const child of layer.sublayers?.toArray?.() ?? []) {
      const found = this.#firstQueryable(child);
      if (found) return found;
    }
    return null;
  }

  async #applySearch(value) {
    const operationId = ++this.operationId;
    const search = value.trim();
    this.state.search = search;
    this.state.where = this.#searchWhere(search);
    document.querySelector("#table-search-clear").hidden = !search;
    if (!await this.#loadIndex(operationId)) return;
    await this.goToPage(0, operationId);
  }

  #searchWhere(search) {
    if (!search) return "1=1";
    const escaped = search.replaceAll("'", "''");
    const fields = this.state.layer?.fields ?? [];
    const strings = fields.filter((field) => field.type === "string").slice(0, 20);
    const clauses = strings.map((field) => `${field.name} LIKE '%${escaped}%'`);
    if (/^-?\d+(?:\.\d+)?$/.test(search)) {
      fields
        .filter((field) => ["small-integer", "integer", "single", "double", "long", "oid"].includes(field.type))
        .slice(0, 10)
        .forEach((field) => clauses.push(`${field.name} = ${Number(search)}`));
    }
    if (!clauses.length) throw new Error("This layer has no searchable text or numeric fields.");
    return `(${clauses.join(" OR ")})`;
  }

  async #loadIndex(operationId) {
    const { layer, where } = this.state;
    const query = layer.createQuery?.() ?? {};
    query.where = this.#combinedWhere(layer, where);
    if (typeof layer.queryObjectIds === "function") {
      const objectIds = (await layer.queryObjectIds(query)) ?? [];
      if (operationId !== this.operationId) return false;
      this.state.objectIds = objectIds;
      this.state.total = objectIds.length;
      this.state.usesObjectIds = true;
      return true;
    }
    this.state.objectIds = [];
    const total = typeof layer.queryFeatureCount === "function"
      ? await layer.queryFeatureCount(query)
      : 0;
    if (operationId !== this.operationId) return false;
    this.state.total = total;
    this.state.usesObjectIds = false;
    return true;
  }

  async goToPage(page, existingOperationId = null) {
    const operationId = existingOperationId ?? ++this.operationId;
    const { layer, objectIds, pageSize, total, usesObjectIds, where } = this.state;
    if (!layer) return;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    page = Math.max(0, Math.min(totalPages - 1, page));
    this.state.page = page;
    let features = [];
    if (total > 0) {
      const ids = objectIds.slice(page * pageSize, (page + 1) * pageSize);
      const query = layer.createQuery?.() ?? {};
      query.outFields = ["*"];
      query.returnGeometry = true;
      if (this.mapController.view?.spatialReference) {
        query.outSpatialReference = this.mapController.view.spatialReference;
      }
      if (usesObjectIds) query.objectIds = ids;
      else {
        query.where = this.#combinedWhere(layer, where);
        query.num = pageSize;
        query.start = page * pageSize;
      }
      const set = await layer.queryFeatures(query);
      if (operationId !== this.operationId) return;
      features = set.features ?? [];
    }
    if (operationId !== this.operationId) return;
    this.#render(features, layer.fields ?? []);
    const suffix = this.state.search ? ` matching “${this.state.search}”` : "";
    document.querySelector("#table-summary").textContent =
      `${total.toLocaleString()} record${total === 1 ? "" : "s"}${suffix} · ${pageSize} per page`;
    document.querySelector("#table-page").textContent = `Page ${page + 1} of ${totalPages}`;
    document.querySelector("#table-prev").disabled = page === 0;
    document.querySelector("#table-next").disabled = page >= totalPages - 1;
  }

  #combinedWhere(layer, tableWhere) {
    const layerWhere = String(layer?.definitionExpression || "").trim();
    const localWhere = String(tableWhere || "1=1").trim();
    if (!layerWhere) return localWhere;
    if (!localWhere || localWhere === "1=1") return `(${layerWhere})`;
    return `(${layerWhere}) AND (${localWhere})`;
  }

  #render(features, fields) {
    this.visibleFeatures = features;
    const container = document.querySelector("#table-content");
    const aliases = new Map(fields.map((field) => [field.name, field.alias || field.name]));
    const keys = [...new Set(features.flatMap((feature) => Object.keys(feature.attributes ?? {})))];
    if (!features.length) {
      container.innerHTML = '<div class="empty-state">No matching records returned.</div>';
      return;
    }
    const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
    container.innerHTML = `<table><thead><tr>${keys.map((key) => `<th>${escape(aliases.get(key) || key)}</th>`).join("")}</tr></thead><tbody>${features
      .map((feature, index) => `<tr data-feature-index="${index}" tabindex="0" title="Zoom to this feature">${keys.map((key) => `<td>${escape(feature.attributes?.[key])}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  }

  #zoomToFeature(index) {
    const feature = this.visibleFeatures[index];
    if (!feature) return;
    this.#cancelAndReset();
    this.mapController.goToFeature(feature).catch((error) =>
      this.events.publish("app:error", { message: error.message }),
    );
  }

  #clearRenderedTable(message = "") {
    this.visibleFeatures = [];
    document.querySelector("#table-title").textContent = "Attribute table";
    document.querySelector("#table-summary").textContent = "";
    document.querySelector("#table-page").textContent = "Page 1";
    document.querySelector("#table-content").innerHTML = message
      ? `<div class="loading-row"><span></span>${message}</div>`
      : "";
  }

  #cancelAndReset() {
    this.operationId += 1;
    this.state = {
      ...this.state,
      layer: null,
      rootUid: null,
      objectIds: [],
      total: 0,
      page: 0,
      where: "1=1",
      search: "",
    };
    this.#clearRenderedTable();
    if (this.dialog.open) this.dialog.close();
    document.body.classList.remove("table-open", "table-resizing");
    requestAnimationFrame(() => this.mapController.resize());
  }

  #displaySettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(DISPLAY_SETTINGS_KEY)) ?? {};
      return {
        ...saved,
        tablePosition: TABLE_POSITIONS.has(saved.tablePosition) ? saved.tablePosition : "overlay-bottom",
        tableDockWidth: Number.isFinite(saved.tableDockWidth) ? saved.tableDockWidth : 520,
        tableDockHeight: Number.isFinite(saved.tableDockHeight) ? saved.tableDockHeight : 420,
      };
    } catch {
      return { tablePosition: "overlay-bottom", tableDockWidth: 520, tableDockHeight: 420 };
    }
  }

  #applyTableSize(settings) {
    document.body.style.setProperty("--table-dock-width", `${settings.tableDockWidth}px`);
    document.body.style.setProperty("--table-dock-height", `${settings.tableDockHeight}px`);
    requestAnimationFrame(() => this.mapController.resize());
  }

  #bindResize() {
    const handle = document.querySelector("#table-resizer");
    const resizeBy = (amount) => {
      const settings = this.#displaySettings();
      if (settings.tablePosition === "dock-bottom") {
        settings.tableDockHeight = Math.min(window.innerHeight * 0.7, Math.max(240, settings.tableDockHeight + amount));
      } else if (["dock-left", "dock-right"].includes(settings.tablePosition)) {
        settings.tableDockWidth = Math.min(window.innerWidth * 0.65, Math.max(360, settings.tableDockWidth + amount));
      } else return;
      localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
      this.#applyTableSize(settings);
    };
    handle.addEventListener("keydown", (event) => {
      const position = document.body.dataset.tablePosition;
      const direction = position === "dock-bottom"
        ? ({ ArrowUp: 20, ArrowDown: -20 })[event.key]
        : ({ ArrowLeft: position === "dock-right" ? 20 : -20, ArrowRight: position === "dock-right" ? -20 : 20 })[event.key];
      if (direction == null) return;
      event.preventDefault();
      resizeBy(direction);
    });
    handle.addEventListener("pointerdown", (event) => {
      const position = document.body.dataset.tablePosition;
      if (!["dock-left", "dock-right", "dock-bottom"].includes(position)) return;
      event.preventDefault();
      const settings = this.#displaySettings();
      const startX = event.clientX;
      const startY = event.clientY;
      const startWidth = settings.tableDockWidth;
      const startHeight = settings.tableDockHeight;
      document.body.classList.add("table-resizing");
      const move = (moveEvent) => {
        if (position === "dock-bottom") {
          settings.tableDockHeight = Math.min(window.innerHeight * 0.7, Math.max(240, startHeight + startY - moveEvent.clientY));
        } else {
          const delta = position === "dock-left" ? moveEvent.clientX - startX : startX - moveEvent.clientX;
          settings.tableDockWidth = Math.min(window.innerWidth * 0.65, Math.max(360, startWidth + delta));
        }
        this.#applyTableSize(settings);
      };
      const finish = () => {
        window.removeEventListener("pointermove", move);
        window.removeEventListener("pointerup", finish);
        window.removeEventListener("pointercancel", finish);
        document.body.classList.remove("table-resizing");
        localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(settings));
        this.mapController.resize();
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", finish);
      window.addEventListener("pointercancel", finish);
    });
  }

  #reportError(error) {
    if (error?.name === "AbortError" || /aborted/i.test(error?.message || "")) return;
    this.events.publish("app:error", { message: error.message });
  }
}
