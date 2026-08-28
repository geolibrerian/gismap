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
      const addressPromise = this.mapController.reverseGeocode(event.mapPoint);
      const response = operationalLayers.length
        ? await view.hitTest(event, { include: operationalLayers })
        : { results: [] };
      const results = [];

      for (const hit of response.results ?? []) {
        const normalized = this.#normalizeHit(hit);
        if (!normalized) continue;
        results.push(normalized);
      }

      const [fallback, address] = await Promise.all([
        this.#queryQueryableLayers(event),
        addressPromise,
      ]);
      if (requestId !== this.requestId) return;
      this.events.publish("identify:complete", {
        point: event.mapPoint,
        address,
        results: this.#dedupe([...fallback, ...results]),
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
      const root = this.#operationalRoot(layer);
      if (!root) return null;
      return {
        kind: "feature",
        layerUid: root.uid,
        layerTitle: graphic?.sourceLayer?.title ?? layer?.title ?? root.title ?? "Map feature",
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

  #operationalRoot(layer) {
    if (!layer) return null;
    const roots = this.mapController.getOperationalLayers();
    let current = layer;
    while (current) {
      if (roots.includes(current)) return current;
      current = current.parent;
    }
    return roots.find((root) => root.allSublayers?.includes?.(layer)) ?? null;
  }

  async #queryQueryableLayers(event) {
    const layers = this.#flattenQueryableLayers(this.mapController.getOperationalLayers());
    const extent = this.#clickExtent(event);
    const jobs = layers
      .filter((layer) => {
        const root = this.#operationalRoot(layer);
        return layer.visible !== false && root?.visible !== false;
      })
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
            const root = this.#operationalRoot(layer);
            return (set.features ?? []).map((graphic) => ({
              kind: "feature",
              layerUid: root?.uid ?? layer.uid,
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
    const samples = [
      event.mapPoint,
      view.toMap({ x: event.x - 8, y: event.y }),
      view.toMap({ x: event.x + 8, y: event.y }),
      view.toMap({ x: event.x, y: event.y - 8 }),
      view.toMap({ x: event.x, y: event.y + 8 }),
    ].filter(Boolean);
    if (samples.length > 1) {
      return {
        type: "extent",
        xmin: Math.min(...samples.map((point) => point.x)),
        ymin: Math.min(...samples.map((point) => point.y)),
        xmax: Math.max(...samples.map((point) => point.x)),
        ymax: Math.max(...samples.map((point) => point.y)),
        spatialReference: event.mapPoint.spatialReference,
      };
    }
    const groundMeters = Math.max(5, Number(view.scale || 10000) * 0.000264583 * 8);
    const geographic = Boolean(event.mapPoint.spatialReference?.isGeographic);
    const latitude = event.mapPoint.latitude ?? event.mapPoint.y;
    const dx = geographic
      ? groundMeters / Math.max(111320 * Math.cos((latitude * Math.PI) / 180), 1000)
      : groundMeters;
    const dy = geographic ? groundMeters / 110540 : groundMeters;
    return {
      type: "extent",
      xmin: event.mapPoint.x - dx,
      ymin: event.mapPoint.y - dy,
      xmax: event.mapPoint.x + dx,
      ymax: event.mapPoint.y + dy,
      spatialReference: event.mapPoint.spatialReference,
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
