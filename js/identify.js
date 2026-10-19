// Great-circle distance in miles; longitude wrapping is handled by sin().
export function centerDistanceMiles(a, b) {
  const radians = Math.PI / 180;
  const dLat = (b[1] - a[1]) * radians;
  const dLon = (b[0] - a[0]) * radians;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * radians) * Math.cos(b[1] * radians) * Math.sin(dLon / 2) ** 2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}

export class IdentifyController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.requestId = 0;
    this.insightCenter = null;
    this.intelligenceCurrent = false;
    this.insightOrigin = null;
    this.insightCurrent = false;
    this.insightDismissMiles = 75;
    this.insightNavigation = 0;
  }

  initialize() {
    this.events.subscribe("map:click", (event) => this.identify(event));
    this.events.subscribe("display:insight-dismiss-distance", ({ miles }) => {
      this.insightDismissMiles = Number.isFinite(miles) && miles > 0 ? miles : null;
    });
    this.events.subscribe("insight:navigation-start", () => { this.insightNavigation += 1; });
    this.events.subscribe("insight:navigation-end", () => {
      this.insightNavigation = Math.max(0, this.insightNavigation - 1);
      if (this.insightNavigation) return;
      const center = this.mapController.getViewState?.()?.center;
      if (this.insightCurrent && Array.isArray(center) && center.slice(0, 2).every(Number.isFinite)) this.insightOrigin = center.slice(0, 2);
    });
    this.events.subscribe("view:stationary", () => {
      const center = this.mapController.getViewState?.()?.center;
      if (!Array.isArray(center) || center.length < 2 || !center.slice(0, 2).every(Number.isFinite)) return;
      if (this.insightCenter) {
        const longitudeDelta = ((center[0] - this.insightCenter[0] + 540) % 360) - 180;
        if (Math.abs(longitudeDelta) > 1e-7 || Math.abs(center[1] - this.insightCenter[1]) > 1e-7) {
          this.insightCenter = null;
          this.intelligenceCurrent = false;
          this.events.publish("identify:cleared", { scope: "intelligence" });
        }
      }
      if (!this.insightNavigation && this.insightCurrent && this.insightOrigin && this.insightDismissMiles && centerDistanceMiles(this.insightOrigin, center) > this.insightDismissMiles) {
        this.insightCurrent = false;
        this.events.publish("insight:distance-exceeded", {});
      }
    });
  }

  /** `event` is the engine's map:click payload: { x, y, mapPoint: { longitude, latitude, … } }. */
  async identify(event) {
    const requestId = ++this.requestId;
    this.intelligenceCurrent = true;
    this.insightCurrent = true;
    const center = this.mapController.getViewState?.()?.center;
    this.insightCenter = Array.isArray(center) && center.length >= 2 && center.slice(0, 2).every(Number.isFinite) ? center.slice(0, 2) : null;
    this.insightOrigin = this.insightCenter?.slice() || null;
    this.events.publish("identify:start", { point: event.mapPoint });
    if (!event.mapPoint) {
      this.events.publish("identify:complete", { point: null, address: null, results: [] });
      return;
    }
    try {
      const [results, address] = await Promise.all([
        this.mapController.identify(event),
        this.mapController.reverseGeocode(event.mapPoint),
      ]);
      if (requestId !== this.requestId) return;
      this.events.publish("identify:complete", {
        point: event.mapPoint,
        address,
        results: this.#dedupe(results),
        ...(this.intelligenceCurrent ? {} : { intelligenceCurrent: false }),
        ...(this.insightCurrent ? {} : { insightCurrent: false }),
      });
    } catch (error) {
      if (requestId !== this.requestId) return;
      this.events.publish("identify:error", { error, point: event.mapPoint });
    }
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
