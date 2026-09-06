import { createFeatureCollection, featureCollectionToKml } from "./export-core.js?v=0.11.1";

let activeJob = null;

self.addEventListener("message", (event) => {
  const message = event.data ?? {};
  if (message.type === "start") {
    activeJob = { id: message.id, metadata: message.metadata ?? {}, format: message.format ?? "geojson", features: [] };
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
    if (activeJob.format === "shapefile") {
      self.postMessage({ type: "complete", id: activeJob.id, collection, featureCount: activeJob.features.length });
    } else {
      const kml = activeJob.format === "kml" || activeJob.format === "kmz";
      const blob = new Blob(
        [kml ? featureCollectionToKml(collection) : JSON.stringify(collection)],
        { type: kml ? "application/vnd.google-earth.kml+xml" : "application/geo+json" },
      );
      self.postMessage({ type: "complete", id: activeJob.id, blob, featureCount: activeJob.features.length });
    }
    activeJob = null;
  }
});
