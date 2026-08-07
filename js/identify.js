export class IdentifyController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.requestId = 0;
  }

  initialize() {
    this.events.subscribe("map:click", (event) => this.identify(event));
  }

  async identify(event) {
    const requestId = ++this.requestId;
    const { view } = this.mapController;
    this.events.publish("identify:start", { point: event.mapPoint });
    if (!event.mapPoint) {
      this.events.publish("identify:complete", { point: null, address: null, results: [] });
      return;
    }
    try {
      const operationalLayers = this.mapController.getOperationalLayers();
      const response = operationalLayers.length
        ? await view.hitTest(event, { include: operationalLayers })
        : { results: [] };
      const results = [];
      const hitLayerUids = new Set();

      for (const hit of response.results ?? []) {
        const normalized = this.#normalizeHit(hit);
        if (!normalized) continue;
        results.push(normalized);
        if (normalized.layerUid) hitLayerUids.add(normalized.layerUid);
      }

      const fallback = await this.#queryQueryableLayers(event, hitLayerUids);
      results.push(...fallback);
      const address = await this.mapController.reverseGeocode(event.mapPoint);
      if (requestId !== this.requestId) return;
      this.events.publish("identify:complete", {
        point: event.mapPoint,
        address,
        results: this.#dedupe(results),
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.events.publish("identify:error", { error, point: event.mapPoint });
    }
  }

  #normalizeHit(hit) {
    if (hit.type === "graphic" || hit.graphic) {
      const graphic = hit.graphic;
      const layer = graphic?.layer || graphic?.sourceLayer || graphic?.origin?.layer;
      if (!this.#isOperationalLayer(layer)) return null;
      return {
        kind: "feature",
        layerUid: layer?.uid ?? null,
        layerTitle: layer?.title ?? "Map feature",
        attributes: graphic?.attributes ?? {},
        geometry: graphic?.geometry ?? null,
        graphic,
      };
    }
    if (hit.type === "media" || hit.element) {
      return { kind: "media", layerTitle: hit.layer?.title ?? "Media", attributes: {} };
    }
    if (hit.type === "raster-pixel" || hit.pixelData) {
      return {
        kind: "raster",
        layerUid: hit.layer?.uid ?? null,
        layerTitle: hit.layer?.title ?? "Imagery",
        attributes: { "Pixel value": hit.pixelData?.pixelValue ?? hit.value ?? "No data" },
      };
    }
    return null;
  }

  #isOperationalLayer(layer) {
    if (!layer) return false;
    const roots = this.mapController.getOperationalLayers();
    let current = layer;
    while (current) {
      if (roots.includes(current)) return true;
      current = current.parent;
    }
    return roots.some((root) => root.allSublayers?.includes?.(layer));
  }

  async #queryQueryableLayers(event, hitLayerUids) {
    const layers = this.#flattenQueryableLayers(this.mapController.getOperationalLayers());
    const extent = this.#clickExtent(event);
    const jobs = layers
      .filter((layer) => layer.visible !== false && !hitLayerUids.has(layer.uid))
      .map(async (layer) => {
        try {
          if (typeof layer.queryFeatures === "function") {
            const query = layer.createQuery?.() ?? {};
            Object.assign(query, {
              geometry: extent,
              spatialRelationship: "intersects",
              outFields: ["*"],
              returnGeometry: true,
              num: 10,
            });
            const set = await layer.queryFeatures(query);
            return (set.features ?? []).map((graphic) => ({
              kind: "feature",
              layerUid: layer.uid,
              layerTitle: layer.title ?? layer.parent?.title ?? "Layer",
              attributes: graphic.attributes ?? {},
              geometry: graphic.geometry ?? null,
              graphic,
            }));
          }
          if (typeof layer.identify === "function") {
            const identified = await layer.identify(event.mapPoint);
            return [{
              kind: "raster",
              layerUid: layer.uid,
              layerTitle: layer.title ?? "Imagery",
              attributes: identified?.value ? { Value: identified.value } : {},
            }];
          }
        } catch (error) {
          console.debug(`Identify fallback skipped for ${layer.title}`, error);
        }
        return [];
      });
    return (await Promise.all(jobs)).flat();
  }

  #flattenQueryableLayers(layers) {
    const result = [];
    const visit = (layer) => {
      if (layer.sublayers?.length) layer.sublayers.forEach(visit);
      else result.push(layer);
    };
    layers.forEach(visit);
    return result;
  }

  #clickExtent(event) {
    const view = this.mapController.view;
    const a = view.toMap({ x: event.x - 5, y: event.y - 5 });
    const b = view.toMap({ x: event.x + 5, y: event.y + 5 });
    if (!a || !b) {
      const tolerance = Math.max(view.resolution * 6, 0.00001);
      return {
        type: "extent",
        xmin: event.mapPoint.x - tolerance,
        ymin: event.mapPoint.y - tolerance,
        xmax: event.mapPoint.x + tolerance,
        ymax: event.mapPoint.y + tolerance,
        spatialReference: event.mapPoint.spatialReference,
      };
    }
    return {
      type: "extent",
      xmin: Math.min(a.x, b.x),
      ymin: Math.min(a.y, b.y),
      xmax: Math.max(a.x, b.x),
      ymax: Math.max(a.y, b.y),
      spatialReference: view.spatialReference,
    };
  }

  #dedupe(results) {
    const seen = new Set();
    return results.filter((result) => {
      const attributes = result.attributes ?? {};
      const meaningful = Object.entries(attributes).filter(
        ([key, value]) => !key.startsWith("_") && value !== null && value !== "",
      );
      if (result.kind === "feature" && !meaningful.length) return false;
      const key = `${result.layerTitle}:${attributes.OBJECTID ?? attributes.FID ?? JSON.stringify(meaningful)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
}
