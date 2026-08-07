export class AttributeTableController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.dialog = document.querySelector("#table-dialog");
    this.state = {
      layer: null,
      objectIds: [],
      usesObjectIds: true,
      total: 0,
      page: 0,
      pageSize: 25,
      where: "1=1",
      search: "",
    };
  }

  initialize() {
    document.querySelector("#table-close").addEventListener("click", () => this.dialog.close());
    document.querySelector("#table-prev").addEventListener("click", () => this.goToPage(this.state.page - 1));
    document.querySelector("#table-next").addEventListener("click", () => this.goToPage(this.state.page + 1));
    document.querySelector("#table-search").addEventListener("submit", (event) => {
      event.preventDefault();
      this.#applySearch(document.querySelector("#table-search-input").value).catch((error) =>
        this.events.publish("app:error", { message: error.message }),
      );
    });
    document.querySelector("#table-search-clear").addEventListener("click", () => {
      document.querySelector("#table-search-input").value = "";
      this.#applySearch("").catch((error) =>
        this.events.publish("app:error", { message: error.message }),
      );
    });
    this.events.subscribe("table:open", ({ uid }) => this.open(uid));
  }

  async open(uid) {
    try {
      let layer = this.mapController.findLayer(uid);
      layer = this.#firstQueryable(layer);
      if (!layer || typeof layer.queryFeatures !== "function") {
        throw new Error("This layer does not expose a queryable attribute table.");
      }
      await layer.load?.();
      this.state = {
        ...this.state,
        layer,
        objectIds: [],
        page: 0,
        where: "1=1",
        search: "",
      };
      document.querySelector("#table-title").textContent = layer.title || layer.parent?.title || "Layer";
      document.querySelector("#table-search-input").value = "";
      document.querySelector("#table-search-clear").hidden = true;
      if (!this.dialog.open) this.dialog.show();
      await this.#loadIndex();
      await this.goToPage(0);
    } catch (error) {
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
    const search = value.trim();
    this.state.search = search;
    this.state.where = this.#searchWhere(search);
    document.querySelector("#table-search-clear").hidden = !search;
    await this.#loadIndex();
    await this.goToPage(0);
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

  async #loadIndex() {
    const { layer, where } = this.state;
    const query = layer.createQuery?.() ?? {};
    query.where = where;
    if (typeof layer.queryObjectIds === "function") {
      const objectIds = (await layer.queryObjectIds(query)) ?? [];
      this.state.objectIds = objectIds;
      this.state.total = objectIds.length;
      this.state.usesObjectIds = true;
      return;
    }
    this.state.objectIds = [];
    this.state.total = typeof layer.queryFeatureCount === "function"
      ? await layer.queryFeatureCount(query)
      : 0;
    this.state.usesObjectIds = false;
  }

  async goToPage(page) {
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
      query.returnGeometry = false;
      if (usesObjectIds) query.objectIds = ids;
      else {
        query.where = where;
        query.num = pageSize;
        query.start = page * pageSize;
      }
      const set = await layer.queryFeatures(query);
      features = set.features ?? [];
    }
    this.#render(features, layer.fields ?? []);
    const suffix = this.state.search ? ` matching “${this.state.search}”` : "";
    document.querySelector("#table-summary").textContent =
      `${total.toLocaleString()} record${total === 1 ? "" : "s"}${suffix} · ${pageSize} per page`;
    document.querySelector("#table-page").textContent = `Page ${page + 1} of ${totalPages}`;
    document.querySelector("#table-prev").disabled = page === 0;
    document.querySelector("#table-next").disabled = page >= totalPages - 1;
  }

  #render(features, fields) {
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
      .map((feature) => `<tr>${keys.map((key) => `<td>${escape(feature.attributes?.[key])}</td>`).join("")}</tr>`)
      .join("")}</tbody></table>`;
  }
}
