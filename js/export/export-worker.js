import { createFeatureCollection } from "./export-core.js";

let activeJob = null;

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  if (message.type === "start") {
    activeJob = { id: message.id, metadata: message.metadata ?? {}, features: [] };
    return;
  }
  if (!activeJob || message.id !== activeJob.id) return;
  if (message.type === "batch") {
    activeJob.features.push(...(message.features ?? []));
    self.postMessage({ type: "progress", id: activeJob.id, processed: activeJob.features.length });
    return;
  }
  if (message.type === "cancel") {
    activeJob = null;
    return;
  }
  if (message.type === "finish") {
    const collection = createFeatureCollection(activeJob.features, activeJob.metadata);
    const blob = new Blob([JSON.stringify(collection)], { type: "application/geo+json" });
    self.postMessage({ type: "complete", id: activeJob.id, blob, featureCount: activeJob.features.length });
    activeJob = null;
  }
});
