export class IdentifyController {
  constructor(events, mapController) {
    this.events = events;
    this.mapController = mapController;
    this.requestId = 0;
  }

  initialize() {
    this.events.subscribe("map:click", (event) => this.identify(event));
  }

  /** `event` is the engine's map:click payload: { x, y, mapPoint: { longitude, latitude, … } }. */
  async identify(event) {
    const requestId = ++this.requestId;
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
