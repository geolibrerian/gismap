import { createCinematicTimeline } from "./timeline-controller.js?v=0.1.0";
import { normalizeTemporalFeatures, observedFeatureIdsAt, observedFeaturesAt, temporalModelInExtent } from "./temporal-adapter.js?v=0.1.2-localwindow1";
import { exportCinematicSpec, importCinematicSpec } from "./state.js?v=0.2.0";
import { CINEMATIC_EFFECTS, effectFields, effectRanges, resolveEffect } from "./cinematic-effects.js?v=0.2.0";

// Engine adapters may implement a transient operation synchronously (for
// example, removing an already-loaded Three.js item) or asynchronously. Keep
// optional cleanup safe in either case, including unsupported adapters.
const attempt = (operation, fallback = null) => Promise.resolve().then(operation).catch(() => fallback);

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
    this.renderedTimeMode = null;
    this.localWindow = false;
    this.localModels = new Map();
    this.localEmpty = false;
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
      const previousOpacity = Number.isFinite(Number(layer.opacity)) ? Number(layer.opacity) : 1;
      const effectRange = effectRanges(features, effectFields(layer.fields || [], features[0]?.attributes || features[0]?.properties));
      this.layers.set(layer.uid, { layer, config, model, effectRange, effectUid: `cinematic:${this.spec.cinematic.id}:${layer.uid}`, previousOpacity, previousFilter: await attempt(() => this.mapController.getFeatureFilter(layer.uid)) });
      if (config.animation.opacity != null) await attempt(() => this.mapController.setOpacity(layer.uid, config.animation.opacity), false);
    }
    this.#resetTimeline();
    await this.renderTask;
    return this.state();
  }

  state() {
    const timeline = this.timeline?.state() || null;
    const timeMode = this.spec?.cinematic.clock.timeMode || "instant";
    return {
      spec: this.spec ? exportCinematicSpec(this.spec) : null, timeline, localWindow: this.localWindow, localEmpty: this.localEmpty,
      layers: [...this.layers.values()].map(({ layer, model, config }) => {
        const activeModel = this.localModels.get(layer.uid) || model;
        const effect = this.#effectFor(layer, config);
        return { uid: layer.uid, title: layer.title, ticks: activeModel.ticks, invalid: model.invalid, timeField: config.temporal.startField,
          effect, effectNote: CINEMATIC_EFFECTS[effect]?.note || "",
          observedCount: timeline && !this.localEmpty ? observedFeaturesAt(activeModel, timeline.observationTime, { timeMode }).length : 0 };
      }),
    };
  }
  play() { this.timeline?.play(); }
  pause() { this.timeline?.pause(); }
  toggle() { this.timeline?.toggle(); }
  seek(time) { this.timeline?.seek(time); }
  seekObservation(index) { this.timeline?.seekObservation(index); }
  nextObservation() { this.timeline?.nextObservation(); }
  previousObservation() { this.timeline?.previousObservation(); }
  setRate(rate) {
    this.timeline?.setRate(rate);
    if (this.spec) this.spec.cinematic.clock.rate = this.timeline?.state().playbackRate ?? this.spec.cinematic.clock.rate;
  }
  setTimeMode(timeMode) {
    if (!this.spec) return;
    this.spec.cinematic.clock.timeMode = timeMode === "cumulative" ? "cumulative" : "instant";
    const snapshot = this.timeline?.state();
    if (snapshot) this.#render(snapshot);
  }
  setIntent(intent) {
    if (!this.spec) return;
    this.spec.cinematic.intent = ["explore", "investigate", "present"].includes(intent) ? intent : "explore";
    this.onState(this.state());
  }
  setLocalWindow(enabled) {
    this.localWindow = enabled === true;
    return this.refreshLocalWindow();
  }
  refreshLocalWindow() {
    if (!this.spec) return false;
    if (!this.localWindow) {
      this.localModels.clear(); this.localEmpty = false; this.#resetTimeline(); return true;
    }
    const extent = this.mapController.getViewExtent?.();
    if (!extent) return false;
    this.localModels = new Map([...this.layers.values()].map(({ layer, model }) => [layer.uid, temporalModelInExtent(model, extent)]));
    const ticks = [...new Set([...this.localModels.values()].flatMap((model) => model.ticks))];
    this.localEmpty = !ticks.length;
    if (ticks.length) this.#resetTimeline(ticks);
    else {
      this.renderedObservationTime = null;
      this.renderedTimeMode = null;
      const snapshot = this.timeline?.state();
      if (snapshot) this.#render(snapshot);
    }
    return !this.localEmpty;
  }
  setBoundaryGlow(enabled) { this.setEffect(enabled === true ? "glow" : "none"); }
  /** The decorative effect for every cinematic layer: a CINEMATIC_EFFECTS key or "auto". */
  setEffect(type) {
    if (!this.spec) return;
    for (const layer of this.spec.cinematic.layers) {
      layer.animation.effect = { ...layer.animation.effect, type: type === "auto" || CINEMATIC_EFFECTS[type] ? type : "none" };
      layer.animation.outline = { color: layer.animation.outline?.color || "#ff8136", glow: layer.animation.effect.type !== "none" };
    }
    // Effects use the same observation snapshot, so deliberately invalidate the
    // render cache when their setting changes at a paused observation.
    this.renderedObservationTime = null;
    this.renderedTimeMode = null;
    const snapshot = this.timeline?.state();
    if (snapshot) this.#render(snapshot);
  }
  async setLayerOpacity(opacity) {
    if (!this.spec) return;
    const next = Math.min(1, Math.max(0.05, Number(opacity) || 1));
    await Promise.all([...this.layers.values()].map(async ({ layer, config }) => {
      config.animation.opacity = next;
      await attempt(() => this.mapController.setOpacity(layer.uid, next), false);
    }));
    this.onState(this.state());
  }
  async focusCurrentObservation({ animate = true } = {}) {
    const snapshot = this.timeline?.state();
    if (!snapshot || typeof this.mapController.goToFeatures !== "function") return false;
    const timeMode = this.spec?.cinematic.clock.timeMode || "instant";
    const features = [...this.layers.values()].flatMap(({ layer, model }) => observedFeaturesAt(this.localModels.get(layer.uid) || model, snapshot.observationTime, { timeMode })
      .map((observation) => observation.feature)
      .filter((feature) => feature?.geometry));
    return features.length ? attempt(() => this.mapController.goToFeatures(features, { animate }), false) : false;
  }
  exportCinematicSpec() { return exportCinematicSpec(this.spec); }

  async destroy() {
    this.unsubscribe?.(); this.unsubscribe = null;
    this.timeline?.destroy(); this.timeline = null;
    this.pendingSnapshot = null;
    await this.renderTask?.catch(() => {});
    this.renderTask = null;
    await Promise.all([...this.layers.values()].map(async ({ layer, effectUid, previousFilter, previousOpacity }) => {
      await attempt(() => this.mapController.setFeatureFilter(layer.uid, previousFilter), false);
      await attempt(() => this.mapController.setOpacity(layer.uid, previousOpacity), false);
      if (typeof this.mapController.clearCinematicEffect === "function") await attempt(() => this.mapController.clearCinematicEffect(effectUid), false);
    }));
    this.layers.clear(); this.localModels.clear(); this.localWindow = false; this.localEmpty = false; this.spec = null; this.renderedObservationTime = null; this.renderedTimeMode = null;
  }

  #effectFor(layer, config) {
    const type = config.animation?.effect?.type || "none";
    if (type === "none") return "none";
    return resolveEffect(type, { title: layer.title, geometryType: layer.geometryType, fields: layer.fields || [] });
  }

  #resetTimeline(explicitTicks = null) {
    const previous = this.timeline?.state();
    const wasPlaying = previous?.playing === true;
    this.unsubscribe?.(); this.unsubscribe = null;
    this.timeline?.destroy();
    const ticks = explicitTicks || [...new Set([...this.layers.values()].flatMap(({ layer, model }) => (this.localModels.get(layer.uid) || model).ticks))].sort((a, b) => a - b);
    this.timeline = createCinematicTimeline({ ticks, durationSeconds: this.spec.cinematic.clock.durationSeconds, rate: this.spec.cinematic.clock.rate, loop: this.spec.cinematic.clock.loop, reducedMotion: globalThis.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches });
    this.renderedObservationTime = null;
    this.renderedTimeMode = null;
    this.unsubscribe = this.timeline.subscribe((snapshot) => this.#render(snapshot));
    if (wasPlaying) this.timeline.play();
  }

  async #render(snapshot) {
    this.pendingSnapshot = snapshot;
    if (this.renderTask) return this.renderTask;
    this.renderTask = (async () => {
      while (this.pendingSnapshot) {
        const next = this.pendingSnapshot;
        this.pendingSnapshot = null;
        const timeMode = this.spec?.cinematic.clock.timeMode || "instant";
        if (next.observationTime !== this.renderedObservationTime || timeMode !== this.renderedTimeMode) {
          await Promise.all([...this.layers.values()].map(async ({ layer, config, model, effectUid, effectRange }) => {
            const activeModel = this.localModels.get(layer.uid) || model;
            const objectIds = this.localEmpty ? [] : observedFeatureIdsAt(activeModel, next.observationTime, { timeMode });
            await this.mapController.setFeatureFilter(layer.uid, { objectIds });
            const effect = this.#effectFor(layer, config);
            if (typeof this.mapController.setCinematicEffect === "function" && effect !== "none") {
              const observations = this.localEmpty ? [] : observedFeaturesAt(activeModel, next.observationTime, { timeMode });
              // "Fresh" features were first observed at this tick: effects flare them as they appear.
              await attempt(() => this.mapController.setCinematicEffect(effectUid, {
                type: "observed-effect",
                effect,
                color: config.animation.effect?.color || null,
                intensity: config.animation.effect?.intensity ?? 1,
                fields: layer.fields || [],
                ranges: effectRange,
                items: observations.map((observation) => ({ feature: observation.feature, fresh: observation.time === next.observationTime })),
              }), false);
            } else if (typeof this.mapController.clearCinematicEffect === "function") {
              await attempt(() => this.mapController.clearCinematicEffect(effectUid), false);
            }
          }));
          this.renderedObservationTime = next.observationTime;
          this.renderedTimeMode = timeMode;
        }
        this.onState(this.state());
      }
    })().finally(() => { this.renderTask = null; });
    return this.renderTask;
  }
}
