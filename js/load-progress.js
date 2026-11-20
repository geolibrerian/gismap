// While a map link builds, a strip over the map lists its own stages, one per layer and
// analysis step, with real counts: "Census blocks 3,200 / 7,843 → Dots → Hexagons".
// Counts come from the engine's layer:progress events (MapLibre service layers); other
// layers tick off when they finish loading. A hexagon step can also draw a preview,
// binned again from the pages received so far, until its real result replaces it.
import { loadH3, loadTurf, runSpatialOperation } from "./spatial-analysis.js?v=0.69.0-extent";

const SHOW_AFTER_MS = 600;
const HIDE_AFTER_MS = 1600;
const PREVIEW_EVERY_MS = 1200;
const NOUNS = { hexbin: ["hexagon", "hexagons"], "random-points": ["dot", "dots"] };

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const number = (value) => Number(value).toLocaleString("en-US");

/**
 * Time left at the rate since the first features arrived (`first` is { at, loaded }), so a
 * slow first response does not inflate it; null until there are two arrivals to judge by.
 */
export function timeLeft({ loaded, total, first }, now = Date.now()) {
  const elapsed = first ? (now - first.at) / 1000 : 0;
  const gained = first ? loaded - first.loaded : 0;
  if (!(gained > 0) || !(total > loaded) || elapsed < 1) return null;
  const seconds = Math.ceil((elapsed / gained) * (total - loaded));
  return seconds < 60 ? `about ${seconds} s left` : `about ${Math.ceil(seconds / 60)} min left`;
}

const STEP_LABELS = { hexbin: "Hexagons", "random-points": "Random points" };

/** A stage name for an analysis step: its title, or what the operation makes. */
export const stepLabel = (step) => step.title || STEP_LABELS[step.operation] || `${step.operation[0].toUpperCase()}${step.operation.slice(1).replace(/-/g, " ")}`;

/** What a finished step made, such as "42,232 dots". */
export function resultLabel(operation, count) {
  const [one, many] = NOUNS[operation] || ["feature", "features"];
  return `${number(count)} ${count === 1 ? one : many}`;
}

/**
 * The steps a hexagon preview can redo as pages arrive: a hexbin of a layer, or random
 * points from a layer followed by a hexbin of them. Returns { layer, chain } or null.
 */
export function previewChain(analysis = []) {
  for (const [index, step] of analysis.entries()) {
    if (step.operation !== "hexbin" || step.overlay !== undefined) continue;
    if (Number.isInteger(step.input)) return { layer: step.input, hexbin: index, chain: [step] };
    const source = analysis[step.input?.step];
    if (source?.operation === "random-points" && Number.isInteger(source.input)) return { layer: source.input, hexbin: index, chain: [source, step] };
  }
  return null;
}

export function createLoadProgress({ events, mapController, documentRef = globalThis.document }) {
  const latest = new Map();
  let current = null;
  events.subscribe("layer:progress", (update) => {
    latest.set(update.uid, update);
    current?.layerUpdate(update);
  });

  /** Starts a strip for `stages` ([{ id, label }]); returns the tracker map-spec-api reports to. */
  function begin(stages) {
    current?.dispose();
    const state = new Map(stages.map((stage) => [stage.id, { ...stage, status: "pending", loaded: null, total: null, detail: "" }]));
    const uids = new Map();
    // Map links add layers one at a time, and an add returns only when its layer has loaded:
    // until then, progress from a layer not yet known belongs to the stage being added.
    let adding = null;
    let element = null;
    let finished = false;
    let preview = null;
    const showTimer = setTimeout(() => { if (!finished) render(); }, SHOW_AFTER_MS);
    // Redrawn every second while shown, so a time estimate grows honestly while a slow page is awaited.
    const tick = setInterval(() => { if (element && !finished) render(); }, 1000);
    let hideTimer = null;

    function render() {
      const host = documentRef.querySelector(".map-workspace");
      if (!host) return;
      if (!element) {
        element = documentRef.createElement("div");
        element.className = "load-progress";
        element.setAttribute("role", "status");
        host.append(element);
      }
      element.setAttribute("aria-busy", String(!finished));
      element.classList.toggle("is-finished", finished);
      element.innerHTML = `<ol>${[...state.values()].map((stage) => {
        const counted = stage.total > 0 ? Math.min(1, (stage.loaded || 0) / stage.total) : null;
        const count = stage.status === "done" ? stage.detail || "✓"
          : stage.status === "failed" ? stage.detail || "failed"
            : stage.total > 0 ? (stage.loaded > 0 ? `${number(stage.loaded)} / ${number(stage.total)}` : `${number(stage.total)} to fetch`)
              : stage.detail || (stage.status === "active" ? "connecting…" : "");
        const left = stage.status === "active" && stage.total ? timeLeft(stage) : null;
        return `<li class="load-progress__stage is-${stage.status}"${counted === null ? "" : ` style="--progress:${counted.toFixed(3)}"`}><span class="load-progress__label">${escapeHtml(stage.label)}</span>${count ? `<span class="load-progress__count">${escapeHtml(count)}</span>` : ""}${left ? `<span class="load-progress__left">${escapeHtml(left)}</span>` : ""}</li>`;
      }).join("")}</ol>`;
    }
    const set = (id, patch) => {
      const stage = state.get(id);
      if (!stage) return;
      Object.assign(stage, patch);
      if (element) render();
    };

    const tracker = {
      layerUpdate(update) {
        if (!uids.has(update.uid) && adding && ![...uids.values()].includes(adding)) uids.set(update.uid, adding);
        const id = uids.get(update.uid);
        if (!id) return;
        const stage = state.get(id);
        if (update.loaded > 0 && !stage.first) stage.first = { at: Date.now(), loaded: update.loaded };
        set(id, { status: update.done ? "done" : "active", loaded: update.loaded, total: update.total, detail: update.done ? `${number(update.loaded)} features` : stage.detail });
        preview?.update(update);
      },
      /** The layer stage `id` is being added. */
      starting(id) {
        adding = id;
        set(id, { status: "active" });
      },
      /** The layer stage `id` added the map layer `uid`; it ticks off when the layer has loaded. */
      layer(id, uid) {
        if (adding === id) adding = null;
        uids.set(uid, id);
        if (state.get(id)?.status === "pending") set(id, { status: "active" });
        if (latest.has(uid)) tracker.layerUpdate(latest.get(uid));
        Promise.resolve(mapController.loadLayer?.(uid, { allowTruncated: true })).then(() => {
          if (state.get(id)?.status !== "done") set(id, { status: "done", detail: latest.get(uid)?.done ? `${number(latest.get(uid).loaded)} features` : "" });
        }).catch(() => set(id, { status: "failed" }));
      },
      failed(id, detail = "") {
        if (adding === id) adding = null;
        set(id, { status: "failed", detail });
      },
      step(id, status, detail = "") {
        if (status === "active") set(id, { status, detail: "working…" });
        else set(id, { status, detail });
      },
      /** Draws hexagons from the pages the layer stage `id` has received so far, until stopPreview(). */
      preview(id, chain) {
        const drawing = createHexbinPreview({ mapController, chain });
        preview = { update: (progress) => { if (uids.get(progress.uid) === id) drawing.update(progress); }, dispose: drawing.dispose };
      },
      stopPreview() { preview?.dispose(); preview = null; },
      finish() {
        if (finished) return;
        finished = true;
        tracker.stopPreview();
        clearTimeout(showTimer);
        clearInterval(tick);
        if (!element) return dispose();
        render();
        hideTimer = setTimeout(dispose, HIDE_AFTER_MS);
      },
      dispose,
    };
    function dispose() {
      clearTimeout(showTimer); clearTimeout(hideTimer); clearInterval(tick);
      tracker.stopPreview();
      element?.remove(); element = null;
      if (current === tracker) current = null;
    }
    current = tracker;
    return tracker;
  }
  return { begin };
}

/**
 * A temporary hexagon overlay (the engine's setAnalysisPreview), redone from the features received so far.
 * It uses the step's own options and seed, so it grows into the result that replaces it.
 */
function createHexbinPreview({ mapController, chain }) {
  let disposed = false;
  let busy = false;
  let last = 0;
  let pending = null;
  let timer = null;
  const hexbin = chain.at(-1);
  const libraries = Promise.all([loadTurf(), hexbin.options?.method === "turf" || hexbin.options?.cellKm !== undefined ? null : loadH3()]);

  async function build(progress) {
    const [turf, h3] = await libraries;
    if (disposed || !progress.features?.length) return;
    let input = { type: "FeatureCollection", features: progress.features };
    for (const step of chain) {
      const result = runSpatialOperation(turf, step.operation, { input, options: step.options || {}, h3 });
      if (step.operation === "hexbin") return draw(result);
      input = result.collection;
    }
  }
  function draw({ collection, binning }) {
    if (disposed) return;
    const field = binning.styleField;
    const values = collection.features.map((feature) => Number(feature.properties[field])).filter(Number.isFinite);
    const max = Math.max(1, ...values);
    const areas = collection.features.map((feature) => feature.properties.cell_area_km2).sort((a, b) => a - b);
    const height = Math.min(40000, Math.max(300, Math.sqrt(areas[Math.floor(areas.length / 2)] || 1) * 3000));
    const data = { type: "FeatureCollection", features: collection.features.map((feature) => ({ type: "Feature", geometry: feature.geometry, properties: { v: Math.max(0, Number(feature.properties[field]) || 0) / max } })) };
    mapController.setAnalysisPreview?.(data, { extrude: binning.extrude, height });
  }
  // At most one build at a time, at least PREVIEW_EVERY_MS apart, always from the latest pages.
  function flush() {
    timer = null;
    if (disposed || !pending) return;
    const progress = pending;
    pending = null; busy = true; last = Date.now();
    build(progress).catch(() => { /* A preview that cannot be drawn is simply left out. */ }).finally(() => {
      busy = false;
      if (pending && !disposed) timer = setTimeout(flush, PREVIEW_EVERY_MS);
    });
  }
  return {
    update(progress) {
      if (disposed || progress.done) return;
      pending = progress;
      if (!busy && !timer) timer = setTimeout(flush, Math.max(0, PREVIEW_EVERY_MS - (Date.now() - last)));
    },
    dispose() {
      disposed = true;
      clearTimeout(timer);
      try { mapController.setAnalysisPreview?.(null); } catch { /* The style may already have been replaced. */ }
    },
  };
}
