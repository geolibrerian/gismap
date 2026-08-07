export class AttributeTableController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.dialog = document.querySelector("#table-dialog");
    this.state = { layer: null, objectIds: [], page: 0, pageSize: 25 };
  }

  initialize() {
    document.querySelector("#table-close").addEventListener("click", () => this.dialog.close());
    document.querySelector("#table-prev").addEventListener("click", () => this.goToPage(this.state.page - 1));
    document.querySelector("#table-next").addEventListener("click", () => this.goToPage(this.state.page + 1));
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
      const query = layer.createQuery?.() ?? { where: "1=1" };
      query.where = "1=1";
      const objectIds = typeof layer.queryObjectIds === "function" ? await layer.queryObjectIds(query) : [];
      this.state = { ...this.state, layer, objectIds: objectIds ?? [], page: 0 };
      document.querySelector("#table-title").textContent = layer.title || layer.parent?.title || "Layer";
      this.dialog.showModal();
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

  async goToPage(page) {
    const { layer, objectIds, pageSize } = this.state;
    if (!layer) return;
    const totalPages = Math.max(1, Math.ceil(objectIds.length / pageSize));
    page = Math.max(0, Math.min(totalPages - 1, page));
    this.state.page = page;
    const ids = objectIds.slice(page * pageSize, (page + 1) * pageSize);
    const query = layer.createQuery?.() ?? {};
    query.outFields = ["*"];
    query.returnGeometry = false;
    if (ids.length) query.objectIds = ids;
    else query.where = "1=1";
    query.num = pageSize;
    query.start = ids.length ? undefined : page * pageSize;
    const set = await layer.queryFeatures(query);
    this.#render(set.features ?? [], layer.fields ?? []);
    document.querySelector("#table-summary").textContent = objectIds.length
      ? `${objectIds.length.toLocaleString()} records · ${pageSize} per page`
      : "Records are paged directly from the service.";
    document.querySelector("#table-page").textContent = `Page ${page + 1} of ${totalPages}`;
    document.querySelector("#table-prev").disabled = page === 0;
    document.querySelector("#table-next").disabled = page >= totalPages - 1;
  }

  #render(features, fields) {
    const container = document.querySelector("#table-content");
    const aliases = new Map(fields.map((field) => [field.name, field.alias || field.name]));
    const keys = [...new Set(features.flatMap((feature) => Object.keys(feature.attributes ?? {})))];
    if (!features.length) {
      container.innerHTML = '<div class="empty-state">No records returned.</div>';
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
