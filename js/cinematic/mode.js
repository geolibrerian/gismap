import { createCinematicTimeline } from "./timeline-controller.js?v=0.1.0";
import { normalizeTemporalFeatures, observedFeatureIdsAt } from "./temporal-adapter.js?v=0.1.0";
import { exportCinematicSpec, importCinematicSpec } from "./state.js?v=0.1.0";

/**
 * Bridges the shared cinematic clock to the active engine's transient feature
 * filter. It never edits the layer's saved definition expression or geometry.
 */
export class CinematicModeController {
  constructor({ mapController, onState = () => {} } = {}) {
    this.mapController = mapController;
    this.onState = onState;
    this.layers = new Map();
    this.timeline = null;
    this.unsubscribe = null;
    this.spec = null;
    this.pendingSnapshot = null;
    this.renderTask = null;
    this.renderedObservationTime = null;
  }

  async load(spec, { featuresByLayer = {} } = {}) {
    await this.destroy();
    this.spec = importCinematicSpec(spec);
    for (const config of this.spec.cinematic.layers) {
      const layer = this.mapController.getLayer(config.layerRef);
      if (!layer?.queryable) throw new Error(`Cinematic layer “${config.layerRef}” is not queryable.`);
      const features = featuresByLayer[config.layerRef] || (await this.mapController.queryFeatures(layer.uid, {
        where: layer.where || "1=1", outFields: ["*"], returnGeometry: true, num: Math.min(layer.maxRecordCount || 2000, 5000),
      })).features;
      const model = normalizeTemporalFeatures(features, {
        timeField: config.temporal.startField,
        groupField: config.temporal.groupField,
        objectIdField: config.temporal.featureIdField || layer.objectIdField,
      });
      if (!model.ticks.length) throw new Error(`No valid timestamped observations were found in ${layer.title}.`);
      this.layers.set(layer.uid, { layer, config, model, previousFilter: await this.mapController.getFeatureFilter(layer.uid).catch(() => null) });
    }
    const ticks = [...new Set([...this.layers.values()].flatMap(({ model }) => model.ticks))].sort((a, b) => a - b);
    this.timeline = createCinematicTimeline({ ticks, durationSeconds: this.spec.cinematic.clock.durationSeconds, loop: this.spec.cinematic.clock.loop, reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches });
    this.unsubscribe = this.timeline.subscribe((snapshot) => this.#render(snapshot));
    await this.renderTask;
    return this.state();
  }

  state() { return { spec: this.spec ? exportCinematicSpec(this.spec) : null, timeline: this.timeline?.state() || null, layers: [...this.layers.values()].map(({ layer, model }) => ({ uid: layer.uid, title: layer.title, ticks: model.ticks, invalid: model.invalid })) }; }
  play() { this.timeline?.play(); }
  pause() { this.timeline?.pause(); }
  toggle() { this.timeline?.toggle(); }
  seek(time) { this.timeline?.seek(time); }
  seekObservation(index) { this.timeline?.seekObservation(index); }
  nextObservation() { this.timeline?.nextObservation(); }
  previousObservation() { this.timeline?.previousObservation(); }
  exportCinematicSpec() { return exportCinematicSpec(this.spec); }

  async destroy() {
    this.unsubscribe?.(); this.unsubscribe = null;
    this.timeline?.destroy(); this.timeline = null;
    this.pendingSnapshot = null;
    await this.renderTask?.catch(() => {});
    this.renderTask = null;
    await Promise.all([...this.layers.values()].map(({ layer, previousFilter }) => this.mapController.setFeatureFilter(layer.uid, previousFilter).catch(() => false)));
    this.layers.clear(); this.spec = null; this.renderedObservationTime = null;
  }

  async #render(snapshot) {
    this.pendingSnapshot = snapshot;
    if (this.renderTask) return this.renderTask;
    this.renderTask = (async () => {
      while (this.pendingSnapshot) {
        const next = this.pendingSnapshot;
        this.pendingSnapshot = null;
        if (next.observationTime !== this.renderedObservationTime) {
          await Promise.all([...this.layers.values()].map(async ({ layer, model }) => {
            const objectIds = observedFeatureIdsAt(model, next.observationTime);
            await this.mapController.setFeatureFilter(layer.uid, { objectIds });
          }));
          this.renderedObservationTime = next.observationTime;
        }
        this.onState(this.state());
      }
    })().finally(() => { this.renderTask = null; });
    return this.renderTask;
  }
}
