import { graphicToGeoJSONFeature, safeExportName } from "./export-core.js";

function firstQueryable(layer) {
  if (!layer) return null;
  if (typeof layer.queryFeatures === "function") return layer;
  for (const child of layer.sublayers?.toArray?.() ?? []) {
    const found = firstQueryable(child);
    if (found) return found;
  }
  return null;
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 5000);
}

export class ExportController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.activeJob = null;
  }

  listExportableLayers() {
    return this.mapController.getOperationalLayers().map((root) => {
      const layer = firstQueryable(root);
      return layer ? { uid: root.uid, title: layer.title || root.title || "Untitled layer" } : null;
    }).filter(Boolean);
  }

  cancel() {
    const job = this.activeJob;
    if (!job) return false;
    job.abortController.abort();
    job.worker.postMessage({ type: "cancel", id: job.id });
    job.worker.terminate();
    this.activeJob = null;
    this.events.publish("export:cancelled", { id: job.id });
    return true;
  }

  async exportLayer({ uid, scope = "filtered", fileName } = {}) {
    if (this.activeJob) throw new Error("Another export is already running.");
    const root = this.mapController.findLayer(uid);
    const layer = firstQueryable(root);
    if (!layer) throw new Error("This layer does not expose queryable vector features.");
    await layer.load?.();

    const id = globalThis.crypto?.randomUUID?.() ?? `export-${Date.now()}`;
    const worker = new Worker(new URL("./export-worker.js", import.meta.url), { type: "module" });
    const abortController = new AbortController();
    const title = layer.title || root?.title || "layer";
    const outputName = `${safeExportName(fileName || title)}.geojson`;
    const job = { id, worker, abortController };
    this.activeJob = job;
    this.events.publish("export:start", { id, title, scope });

    try {
      worker.postMessage({ type: "start", id, metadata: { name: title } });
      const query = layer.createQuery?.() ?? {};
      query.outFields = ["*"];
      query.returnGeometry = true;
      query.outSpatialReference = { wkid: 4326 };
      if (scope === "source") query.where = "1=1";
      if (scope === "extent") {
        query.geometry = this.mapController.view?.extent;
        query.spatialRelationship = "intersects";
      }

      const options = { signal: abortController.signal };
      const objectIds = typeof layer.queryObjectIds === "function"
        ? ((await layer.queryObjectIds(query, options)) ?? [])
        : null;
      const total = objectIds
        ? objectIds.length
        : (typeof layer.queryFeatureCount === "function" ? await layer.queryFeatureCount(query, options) : 0);
      const batchSize = Math.max(100, Math.min(2000, layer.capabilities?.query?.maxRecordCount || 1000));
      let retrieved = 0;

      if (objectIds) {
        for (let start = 0; start < objectIds.length; start += batchSize) {
          this.#assertActive(job);
          const pageQuery = layer.createQuery?.() ?? {};
          Object.assign(pageQuery, query, { objectIds: objectIds.slice(start, start + batchSize) });
          const result = await layer.queryFeatures(pageQuery, options);
          const features = (result.features ?? []).map(graphicToGeoJSONFeature);
          retrieved += features.length;
          worker.postMessage({ type: "batch", id, features });
          this.events.publish("export:progress", { id, stage: "retrieving", completed: retrieved, total });
        }
      } else {
        let start = 0;
        do {
          this.#assertActive(job);
          const pageQuery = layer.createQuery?.() ?? {};
          Object.assign(pageQuery, query, { start, num: batchSize });
          const result = await layer.queryFeatures(pageQuery, options);
          const features = (result.features ?? []).map(graphicToGeoJSONFeature);
          retrieved += features.length;
          worker.postMessage({ type: "batch", id, features });
          this.events.publish("export:progress", { id, stage: "retrieving", completed: retrieved, total });
          start += features.length;
          if (!features.length || (!result.exceededTransferLimit && features.length < batchSize)) break;
        } while (true);
      }

      this.#assertActive(job);
      this.events.publish("export:progress", { id, stage: "packaging", completed: retrieved, total: retrieved });
      const completed = new Promise((resolve, reject) => {
        worker.addEventListener("message", (event) => {
          if (event.data?.id !== id) return;
          if (event.data.type === "complete") resolve(event.data);
        });
        worker.addEventListener("error", (event) => reject(new Error(event.message || "The export worker failed.")), { once: true });
      });
      worker.postMessage({ type: "finish", id });
      const result = await completed;
      this.#assertActive(job);
      downloadBlob(result.blob, outputName);
      this.events.publish("export:complete", { id, title, fileName: outputName, featureCount: result.featureCount });
      return result;
    } catch (error) {
      if (error?.name === "AbortError" || this.activeJob !== job) return null;
      this.events.publish("export:error", { id, error });
      throw error;
    } finally {
      worker.terminate();
      if (this.activeJob === job) this.activeJob = null;
    }
  }

  #assertActive(job) {
    if (this.activeJob !== job || job.abortController.signal.aborted) {
      throw new DOMException("Export cancelled", "AbortError");
    }
  }
}
