export class IdentifyController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.requestId = 0;
    this.insightCenter = null;
  }

  initialize() {
    this.events.subscribe("map:click", (event) => this.identify(event));
    this.events.subscribe("view:stationary", () => {
      if (!this.insightCenter) return;
      const center = this.mapController.getViewState?.()?.center;
      if (!Array.isArray(center) || !center.every(Number.isFinite)) return;
      // Longitude may wrap at the antimeridian. Ignore numerical camera jitter,
      // but not changes to the geographic center caused by an actual pan.
      const longitudeDelta = ((center[0] - this.insightCenter[0] + 540) % 360) - 180;
      if (Math.abs(longitudeDelta) <= 1e-7 && Math.abs(center[1] - this.insightCenter[1]) <= 1e-7) return;
      this.insightCenter = null;
      ++this.requestId; // A late identify/geocoder response must not restore the old result.
      this.events.publish("identify:cleared", {});
    });
  }

  /** `event` is the engine's map:click payload: { x, y, mapPoint: { longitude, latitude, … } }. */
  async identify(event) {
    const requestId = ++this.requestId;
    const center = this.mapController.getViewState?.()?.center;
    this.insightCenter = Array.isArray(center) && center.length >= 2 && center.slice(0, 2).every(Number.isFinite) ? center.slice(0, 2) : null;
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
