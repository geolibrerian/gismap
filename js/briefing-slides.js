import { previewGridAtlas, generateGridAtlas } from "./briefing-grid-atlas.js?v=0.1.0";
import { createTimelineSourceCache } from "./briefing-timeline-source.js?v=0.1.0";
// The Slides tab of the Briefing panel: build an ordered set of slides from the
// briefing's features and data, and preview them over the live map. The slides
// themselves are plain data (briefing-document.js); this file only draws and edits.
import {
  MAX_SLIDES,
  SLIDE_TEMPLATES,
  STAT_TYPES,
  addSlide,
  computeStat,
  createSlide,
  duplicateSlide,
  formatStat,
  moveSlide,
  normalizeBriefing,
  removeSlide,
  safeUrl,
  updateBlock,
  updateSlide,
  validateBriefing,
  isRoutineField,
  DISTANCE_UNITS,
  SPATIAL_RELATIONSHIPS,
} from "./briefing-document.js?v=0.35.0";
import { compileWhere } from "./engines/maplibre/where.js?v=0.40.0-timeline";
import { generateTimeline, previewTimeline, isYearField } from "./briefing-timeline.js?v=0.3.0";
import { isDateField, previewDateTimeline } from "./briefing-timeline-dates.js?v=0.2.0";
import { generateFilterSeries, seriesWhere } from "./briefing-data-series.js?v=0.4.0";
import { previewFilterSeries } from "./briefing-series-preview.js?v=0.1.0";
import { briefingLayerRef } from "./briefing-api.js?v=0.53.0";
import { renderMarkdown } from "./markdown.js?v=0.18.2";
import { BriefingPlayer, slideHasMap } from "./briefing-player.js?v=0.38.0-timeline3";
import { expandTimelinePdfSlides } from "./briefing-timeline-pdf.js?v=0.1.0";
import { briefingFileStem, briefingPdf, markdownToText } from "./briefing-pdf.js?v=0.44.2";
import { featureId } from "./presentation-query.js?v=0.30.0";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const templateLabel = (id) => SLIDE_TEMPLATES.find((template) => template.id === id)?.label || "Slide";
const STAT_LABELS = { count: "Count", sum: "Sum", average: "Average", min: "Minimum", max: "Maximum" };
// What each REST spatialRel means for "show only the features that …" (the slide's feature is the query geometry).
const RELATION_LABELS = {
  intersects: "Intersect the feature",
  contains: "Lie inside the feature",
  within: "Contain the feature",
  crosses: "Cross the feature",
  overlaps: "Overlap the feature",
  touches: "Touch its boundary",
  "envelope-intersects": "Touch its bounding box",
  "index-intersects": "Touch its bounding box (fast, approximate)",
  disjoint: "Do not touch the feature",
  relation: "Match a DE-9IM pattern",
};
const UNIT_LABELS = { meters: "m", kilometers: "km", feet: "ft", miles: "mi", "nautical-miles": "nmi", "us-nautical-miles": "US nmi" };
const FILTER_LABELS = { eq: "equals", neq: "is not", contains: "contains", gt: "greater than", gte: "at least", lt: "less than", lte: "at most", is_not_null: "has a value" };

/**
 * `api` connects the tab to the app:
 *   getBriefing(), saveBriefing(briefing), data() -> { layer, fields, records, total,
 *   selectedIds, useAll, visibleRecords, selected, title, label(record) },
 *   mapController, notify(message), share() (opens the share dialog)
 */
export class BriefingSlides {
  constructor(api) {
    this.api = api;
    this.selectedSlideId = null;
    this.saveTimer = null;
    this.timelineSourceCache = createTimelineSourceCache();
    this.timelinePreviewEpoch = 0;
    this.player = new BriefingPlayer({
      getSlides: () => this.briefing.slides.filter((slide) => !slide.hidden),
      slideHtml: (slide, options) => this.slideHtml(slide, options),
      showSlide: (slide) => this.showSlideMap(slide),
      mapController: api.mapController,
      compact: () => api.compact?.() ?? false,
      title: () => api.data().title,
      onClose: () => void this.restoreLayers(),
    });
    // How the other layers looked before a slide changed them: { visible: Map(uid -> bool), filtered: Set(uid) }.
    this.layerState = null;
    this.layerToken = 0;
    this.layerQueue = Promise.resolve();
  }

  /** The briefing's other loaded layers (everything but its main layer), with the reference slides store. */
  otherLayers() {
    const { mapController } = this.api;
    const primary = this.api.data().layer;
    return (mapController.getLayers?.() || [])
      .filter((layer) => layer !== primary && layer.uid !== primary?.uid)
      .map((layer) => ({ layer, ref: briefingLayerRef(mapController, layer) || layer.uid }));
  }

  #findLayer(ref) {
    const wanted = String(ref || "").trim().replace(/\/+$/, "").toLowerCase();
    return this.otherLayers().find((item) => String(item.ref).replace(/\/+$/, "").toLowerCase() === wanted || item.layer.uid === ref || item.layer.id === ref || item.layer.title === ref)?.layer || null;
  }

  /** Puts the other layers back as they were before any slide changed them. */
  restoreLayers(options = {}) {
    const operation = this.layerQueue.then(() => this.#restoreLayersNow(options));
    this.layerQueue = operation.catch(() => {});
    return operation;
  }

  async #restoreLayersNow({ keep = false } = {}) {
    if (!keep) ++this.layerToken;
    const state = this.layerState;
    if (!state) return;
    const { mapController } = this.api;
    for (const layer of mapController.getLayers?.() || []) {
      if (state.visible.has(layer.uid)) mapController.setVisibility(layer.uid, state.visible.get(layer.uid), { silent: true });
      if (state.filtered.has(layer.uid)) await mapController.setFeatureFilter(layer.uid, null);
    }
    state.filtered.clear();
    if (state.primary) {
      await mapController.setFeatureFilter(state.primary.uid, state.primary.filter);
      state.primary = null;
    }
    if (!keep) this.layerState = null;
  }

  /**
   * Shows or hides the other layers as the slide says, and limits each to the
   * features related to the slide's feature: the layer's service answers the
   * relationship (spatialRel, with any distance), and only those features draw.
   */
  applySlideLayers(slide, record = this.#recordFor(slide)) {
    const operation = this.layerQueue.then(() => this.#applySlideLayersNow(slide, record));
    this.layerQueue = operation.catch(() => {});
    return operation;
  }

  async #applySlideLayersNow(slide, record) {
    const token = ++this.layerToken;
    const entries = Array.isArray(slide?.layers) ? slide.layers : null;
    if (!entries && !slide?.dataView && !this.layerState) return;
    const { mapController } = this.api;
    this.layerState ??= { visible: new Map(this.otherLayers().map(({ layer }) => [layer.uid, layer.visible !== false])), filtered: new Set() };
    await this.#restoreLayersNow({ keep: true });
    if (token !== this.layerToken) return;
    if (slide?.dataView) {
      try {
        const data = this.api.data();
        const layer = data.layer;
        const ref = briefingLayerRef(mapController, layer);
        if (!layer || String(ref).replace(/\/+$/, '').toLowerCase() !== String(slide.dataView.layer || '').replace(/\/+$/, '').toLowerCase()) throw new Error('The slide’s source layer is not available.');
        const where = seriesWhere(slide.dataView.filter, data.fields?.fields || layer.fields || []);
        const prior = await mapController.getFeatureFilter(layer.uid);
        if (token !== this.layerToken) return;
        // A FeatureFilter may also contain geometry, time, or objectIds. Keep those
        // constraints while intersecting the generated attribute predicate.
        const filter = { ...(prior || {}), where: prior?.where ? `(${prior.where}) AND (${where})` : where };
        this.layerState.primary = { uid: layer.uid, filter: prior };
        if (!await mapController.setFeatureFilter(layer.uid, filter)) throw new Error('The map engine cannot filter this layer.');
        if (token !== this.layerToken) return;
      } catch (error) {
        this.api.notify?.(`Data-driven slide: ${error.message}`);
      }
    }
    for (const entry of entries || []) {
      const layer = this.#findLayer(entry.layer);
      if (!layer) continue;
      if (!this.layerState.visible.has(layer.uid)) this.layerState.visible.set(layer.uid, layer.visible !== false);
      mapController.setVisibility(layer.uid, entry.visible, { silent: true });
      if (!entry.visible || !entry.relation || !record?.geometry || !layer.objectIdQueryable) continue;
      try {
        const { type, distance, units, relationParameter } = entry.relation;
        const ids = await mapController.queryObjectIds(layer.uid, {
          where: layer.where || "1=1",
          geometry: record.geometry,
          spatialRelationship: type,
          ...(distance ? { distance, units: units || "meters" } : {}),
          ...(type === "relation" ? { relationParameter } : {}),
        }, { layerDefaults: false });
        if (token !== this.layerToken) return;
        // No match draws nothing (an ID that cannot exist), rather than everything.
        if (!await mapController.setFeatureFilter(layer.uid, { objectIds: ids?.length ? ids : [-1] }) || token !== this.layerToken) continue;
        this.layerState.filtered.add(layer.uid);
      } catch (error) {
        this.api.notify?.(`${layer.title || "A layer"}: the relationship could not be checked (${error.message || "the service refused the query"}).`);
      }
    }
  }

  get briefing() {
    return normalizeBriefing(this.api.getBriefing());
  }

  #save(briefing, { render = true } = {}) {
    this.api.saveBriefing(normalizeBriefing(briefing));
    if (render) this.render();
  }

  // Typing saves after a pause without redrawing, so the cursor stays put.
  #saveSoon(change) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.#save(change(this.briefing), { render: false }), 250);
  }

  #idOf(record) {
    return featureId(record, this.api.data().layer?.objectIdField);
  }

  #recordFor(slide) {
    if (!slide?.featureId) return null;
    return this.api.data().records.find((record) => this.#idOf(record) === slide.featureId) || null;
  }

  /** The first five filled-in fields, leaving out IDs and geometry measurements (they can still be ticked). */
  #defaultFacts(record) {
    const { layer, fields } = this.api.data();
    const typed = new Map((fields?.fields || layer?.fields || []).map((field) => [field.name, field]));
    return Object.entries(record?.attributes || {})
      .filter(([key, value]) => value != null && value !== "" && !isRoutineField(typed.get(key) || key, { idField: layer?.objectIdField }))
      .slice(0, 5)
      .map(([key]) => key);
  }

  /** Adds a slide about one feature, prefilled from its record. Used by "Add as slide" in the context panel. */
  addFeatureSlide(record) {
    const id = this.#idOf(record);
    if (!id) return this.api.notify?.("That feature has no ID, so it cannot become a slide.");
    const briefing = this.briefing;
    if (briefing.slides.some((slide) => slide.featureId === id)) return this.api.notify?.("That feature already has a slide.");
    const slide = createSlide("feature", { title: this.api.data().label(record), featureId: id, fields: this.#defaultFacts(record) });
    this.selectedSlideId = slide.id;
    this.#save(addSlide(briefing, slide));
    this.api.notify?.("Slide added. Open the Slides tab to edit it.");
  }

  /** Included features that do not have a slide yet (the Features tab offers to add them). */
  pendingIncluded() {
    const data = this.api.data();
    const included = data.useAll ? data.visibleRecords : data.records.filter((record) => data.selectedIds.has(this.#idOf(record)));
    const existing = new Set(this.briefing.slides.map((slide) => slide.featureId).filter(Boolean));
    return included.filter((record) => {
      const id = this.#idOf(record);
      return id && !existing.has(id);
    });
  }

  /** Adds a feature slide for each included feature without one; returns how many were added. */
  addIncluded() {
    const data = this.api.data();
    const included = data.useAll ? data.visibleRecords : data.records.filter((record) => data.selectedIds.has(this.#idOf(record)));
    let briefing = this.briefing;
    const existing = new Set(briefing.slides.map((slide) => slide.featureId).filter(Boolean));
    let added = 0;
    for (const record of included) {
      const id = this.#idOf(record);
      if (!id || existing.has(id) || briefing.slides.length >= MAX_SLIDES) continue;
      briefing = addSlide(briefing, createSlide("feature", { title: data.label(record), featureId: id, fields: this.#defaultFacts(record) }));
      existing.add(id);
      added += 1;
    }
    this.#save(briefing);
    this.api.notify?.(added ? `Added ${added} feature slide${added === 1 ? "" : "s"}.` : "Every included feature already has a slide.");
    return added;
  }

  #addTemplate(template) {
    const data = this.api.data();
    const after = this.selectedSlideId;
    const slide = createSlide(template, {
      title: template === "title" ? data.title : "",
      camera: ["title", "map-narrative"].includes(template) ? this.#currentCamera() : null,
    });
    this.selectedSlideId = slide.id;
    // New slides go after the one being edited; a title slide always opens the briefing.
    this.#save(addSlide(this.briefing, slide, template === "title" ? undefined : after));
    if (template === "title") this.#save(moveSlide(this.briefing, slide.id, -this.briefing.slides.length));
  }

  #currentCamera() {
    const view = this.api.mapController.getViewState?.();
    const center = view?.center;
    if (!center || !Number.isFinite(center[0])) return null;
    return {
      center: [Number(center[0].toFixed(6)), Number(center[1].toFixed(6))],
      zoom: Number((view.zoom ?? 12).toFixed(2)),
      heading: Number((view.heading ?? 0).toFixed(1)),
      tilt: Number((view.tilt ?? 0).toFixed(1)),
    };
  }

  /** Moves the map to a slide's saved view, or frames its feature. */
  async showSlideMap(slide) {
    const { mapController } = this.api;
    const record = this.#recordFor(slide);
    // A "cut" briefing jumps between views; slides far apart would otherwise fly out and back in.
    const animate = this.briefing.transition !== "cut";
    // Other layers change alongside the camera move, not after it: an interrupted or slow
    // move (advancing quickly, a hidden map) must not leave the previous slide's layers.
    const layers = this.applySlideLayers(slide, record).catch((error) => this.api.notify?.(error.message));
    try {
      const gridBounds = slide.generatedBy?.template === 'grid-atlas' ? slide.generatedBy.bounds : null;
      if (Array.isArray(gridBounds) && gridBounds.length === 4 && gridBounds.every(Number.isFinite) && gridBounds[0] >= -180 && gridBounds[2] <= 180 && gridBounds[1] >= -90 && gridBounds[3] <= 90 && gridBounds[0] < gridBounds[2] && gridBounds[1] < gridBounds[3]) {
        await mapController.setView({ bounds:gridBounds }, { animate });
      } else if (slide.camera) {
        await mapController.setView({ center: slide.camera.center, zoom: slide.camera.zoom, heading: slide.camera.heading, tilt: slide.camera.tilt }, { animate });
      } else if (slide.fit === "feature" && record?.geometry) {
        await mapController.goToFeature(record, { animate });
      }
      if (record) await mapController.highlightFeature?.(record, { pulse: false });
      else mapController.clearFeatureHighlight?.();
    } catch (error) {
      if (error?.name !== "AbortError") this.api.notify?.(error.message);
    }
    await layers;
  }

  render(container = this.container) {
    if (!container) return;
    this.container = container;
    const briefing = this.briefing;
    const data = this.api.data();
    if (!briefing.slides.some((slide) => slide.id === this.selectedSlideId)) this.selectedSlideId = briefing.slides[0]?.id || null;
    // Only features without a slide yet are offered.
    const withSlides = new Set(briefing.slides.map((slide) => slide.featureId).filter(Boolean));
    const included = data.useAll ? data.visibleRecords.map((record) => this.#idOf(record)) : [...data.selectedIds];
    const includedCount = included.filter((id) => id && !withSlides.has(id)).length;
    const issues = validateBriefing(briefing, { featureIds: new Set(data.records.map((record) => this.#idOf(record)).filter(Boolean)) });
    const list = briefing.slides.map((slide, index) => `<li class="briefing-slide-item${slide.id === this.selectedSlideId ? " is-selected" : ""}${slide.hidden ? " is-hidden" : ""}">
      <button type="button" class="briefing-slide-item__main" data-slide-select="${slide.id}" aria-current="${slide.id === this.selectedSlideId}">
        <span class="briefing-slide-item__number">${index + 1}</span>
        <span class="briefing-slide-item__text"><strong>${escapeHtml(slide.title || "Untitled slide")}</strong><small>${escapeHtml(templateLabel(slide.template))}${slide.hidden ? " · hidden" : ""}</small></span>
      </button>
      <span class="briefing-slide-item__actions">
        <button type="button" data-slide-move="-1" data-slide-id="${slide.id}" aria-label="Move up" title="Move up"${index === 0 ? " disabled" : ""}>↑</button>
        <button type="button" data-slide-move="1" data-slide-id="${slide.id}" aria-label="Move down" title="Move down"${index === briefing.slides.length - 1 ? " disabled" : ""}>↓</button>
        <button type="button" data-slide-duplicate="${slide.id}" aria-label="Duplicate" title="Duplicate">⧉</button>
        <button type="button" data-slide-hide="${slide.id}" aria-label="${slide.hidden ? "Show" : "Hide"} slide" title="${slide.hidden ? "Show" : "Hide"} slide">${slide.hidden ? "◌" : "●"}</button>
        <button type="button" class="briefing-slide-item__delete" data-slide-delete="${slide.id}" aria-label="Delete ${escapeHtml(slide.title || "untitled slide")}" title="Delete slide">×</button>
      </span>
    </li>`).join("");
    container.innerHTML = `<div class="briefing-slides">
      <div class="briefing-slides__authoring">
        ${this.api.generate ? `<div class="briefing-slides__auto"><button type="button" data-slides-generate title="Slides from the layer's style, filter and the features you included">✦ ${briefing.slides.length ? "Remake" : "Make"} from the map</button>${this.api.aiReady?.() && briefing.slides.length ? `<button type="button" data-slides-ai title="Let the configured AI describe the opening and each feature">✦ Describe with AI</button>` : ""}</div>` : ""}
        <details class="briefing-series-preview">
          <summary>Explore data-driven templates</summary>
          <p class="form-note">Preview a Filter Series from loaded, included features. Preview does not create slides or change the map; generation adds one filtered map slide per value. Grid Atlas starts with loaded point features.</p>
          <label class="briefing-field"><span>Group by field</span><select data-series-field><option value="">Choose a field</option>${(data.fields?.fields || []).filter(field => field?.name).map(field => `<option value="${escapeHtml(field.name)}">${escapeHtml(field.alias || field.name)}</option>`).join("")}</select></label>
          <button type="button" data-series-preview>Preview subsets</button> <button type="button" data-series-create>Generate slides</button>
          <div data-series-results role="status" aria-live="polite"></div>
        </details>
        <details class="briefing-series-preview">
          <summary>Timeline · data-driven slides</summary>
          <p class="form-note">Create a sequence using an integer year or date field. Date windows use the chosen calendar timezone; the selected end date is inclusive. The map keeps its view and style.</p>
          <label class="briefing-field"><span>Temporal field</span><select data-timeline-field><option value="">Choose a field</option>${(data.fields?.fields || []).filter(field => isYearField(field) || isDateField(field)).map(field => `<option value="${escapeHtml(field.name)}" data-kind="${isDateField(field) ? "date" : "year"}">${escapeHtml(field.alias || field.name)} · ${isDateField(field) ? "date" : "year"}</option>`).join("")}</select></label>
          <div data-timeline-years><label class="briefing-field"><span>Start year</span><input data-timeline-start type="number" min="0" max="9999" step="1" placeholder="e.g. 2015"></label>
          <label class="briefing-field"><span>End year (inclusive)</span><input data-timeline-end type="number" min="0" max="9999" step="1" placeholder="e.g. 2024"></label></div>
          <div data-timeline-dates hidden><label class="briefing-field"><span>Start date</span><input data-timeline-date-start type="date"></label><label class="briefing-field"><span>End date (inclusive)</span><input data-timeline-date-end type="date"></label>
          <label class="briefing-field"><span>Calendar timezone (IANA)</span><input data-timeline-timezone value="UTC" placeholder="America/Los_Angeles"></label><label class="briefing-field"><span>Calendar interval</span><select data-timeline-unit><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option><option value="quarter">Quarter</option><option value="year" selected>Year</option></select></label></div>
          <label class="briefing-field"><span>Interval length</span><input data-timeline-step type="number" min="1" max="1000" step="1" value="1"></label>
          <label class="briefing-field"><span>Show features</span><select data-timeline-mode><option value="interval">During each interval</option><option value="cumulative">Cumulative from start</option><option value="rolling">Rolling window</option><option value="validity">Feature validity period</option></select></label>
          <label class="briefing-field" data-timeline-rolling-wrap hidden><span>Rolling window (years or selected calendar units)</span><input data-timeline-rolling type="number" min="1" max="1000" step="1" value="2"></label>
          <label class="briefing-field" data-timeline-end-field-wrap hidden><span>Exclusive end field (empty means ongoing)</span><select data-timeline-end-field><option value="">Choose an end field</option>${(data.fields?.fields || []).filter(field => isYearField(field) || isDateField(field)).map(field => `<option value="${escapeHtml(field.name)}">${escapeHtml(field.alias || field.name)}</option>`).join("")}</select></label>
          <label class="briefing-field"><span>Additional statistic</span><select data-timeline-stat><option value="">Count only</option><option value="sum">Total</option><option value="average">Mean</option><option value="min">Minimum</option><option value="max">Maximum</option></select></label>
          <label class="briefing-field" data-timeline-stat-field-wrap hidden><span>Numeric field</span><select data-timeline-stat-field><option value="">Choose a field</option>${(data.fields?.numeric || []).map(field => `<option value="${escapeHtml(field.name)}">${escapeHtml(field.alias || field.name)}</option>`).join("")}</select></label>
          <label><input type="checkbox" data-timeline-narration> Add editable draft descriptions from loaded counts</label>
          <label class="briefing-field"><span>Presentation</span><select data-timeline-presentation><option value="slide-series">One slide per interval</option><option value="single-slide">Interactive timeline on one slide</option></select></label>
          <label><input type="checkbox" data-timeline-source> Query complete ArcGIS source for preview counts and chart</label><p class="form-note">Queries the service using the layer filter; ignores the loaded selection and search. Availability depends on the service. Slide statistics and draft text still use loaded features.</p>
          <button type="button" data-timeline-preview>Preview timeline</button> <button type="button" data-timeline-create>Generate slides</button>
          <div data-timeline-results role="status" aria-live="polite"></div>
        </details>
        <details class="briefing-series-preview">
          <summary>Grid Atlas · point map slides</summary>
          <p class="form-note">Divide the loaded, included point features into cells. Each point is assigned once. Counts and empty-cell removal reflect this loaded selection, not the complete source. Map features remain visible for context.</p>
          <label class="briefing-field"><span>Rows</span><input data-grid-rows type="number" min="1" max="20" step="1" value="3"></label>
          <label class="briefing-field"><span>Columns</span><input data-grid-columns type="number" min="1" max="20" step="1" value="3"></label>
          <label class="briefing-field"><span>Traversal</span><select data-grid-order><option value="row-major">Row by row</option><option value="column-major">Column by column</option><option value="snake">Snake</option></select></label>
          <label><input type="checkbox" data-grid-skip> Skip cells without loaded points</label>
          <div><button type="button" data-grid-preview>Preview grid</button> <button type="button" data-grid-create>Generate slides</button></div>
          <div data-grid-results role="status" aria-live="polite"></div>
        </details>
        <div class="briefing-slides__add">
          <label><span>Add a slide</span><select data-slide-template>${SLIDE_TEMPLATES.filter((template) => template.id !== "feature").map((template) => `<option value="${template.id}">${escapeHtml(template.label)}</option>`).join("")}</select></label>
          <button type="button" data-slide-add>Add</button>
        </div>
        <button type="button" class="briefing-slides__included" data-slides-add-included${includedCount ? "" : " disabled"}>${includedCount ? `Add ${includedCount} included feature${includedCount === 1 ? "" : "s"} as slides` : included.length ? "Every included feature has a slide" : "Include features to add them as slides"}</button>
        ${briefing.slides.length ? `<ol class="briefing-slide-list" aria-label="Briefing slides">${list}</ol>` : `<p class="briefing-slides__empty">No slides yet. Make them from the map in one step, add a title slide, or turn the features you included into slides. A briefing without slides works exactly as before.</p>`}
        ${issues.length ? `<details class="briefing-slides__issues"><summary>${issues.length} thing${issues.length === 1 ? "" : "s"} to check</summary><ul>${issues.map((issue) => `<li class="is-${issue.level}"><button type="button" data-slide-select="${issue.slideId}">${escapeHtml(issue.message)}</button></li>`).join("")}</ul></details>` : ""}
        ${briefing.slides.length ? `<label class="briefing-slides__transition"><span>Between slides</span><select data-slides-transition><option value="pan"${briefing.transition === "cut" ? "" : " selected"}>Pan and zoom</option><option value="cut"${briefing.transition === "cut" ? " selected" : ""}>Cut (jump straight there)</option></select></label>` : ""}
        ${briefing.slides.length ? `<div class="briefing-slides__actions"><button type="button" class="briefing-slides__present" data-slides-preview data-mobile-bar="primary" data-bar-label="Preview slides">Preview slides</button><button type="button" data-slides-share data-mobile-bar data-bar-label="Share">Share &amp; PDF</button></div>${this.api.createTour ? `<button type="button" class="briefing-link-button" data-slides-tour>Make a guided tour from these slides →</button>` : ""}` : ""}
      </div>
      <section class="briefing-slide-editor" data-slide-editor aria-label="Selected slide settings"></section>
    </div>`;
    const slide = briefing.slides.find((item) => item.id === this.selectedSlideId);
    if (slide) this.#renderEditor(container.querySelector("[data-slide-editor]"), slide, briefing);
    this.#bind(container);
  }

  /** Slide details: which other layers show with the main layer, and which of their features. */
  #layersSection(slide, record) {
    const others = this.otherLayers();
    if (!others.length) return "";
    const main = this.api.data().layer;
    const entries = new Map((slide.layers || []).map((entry) => [entry.layer, entry]));
    const canRelate = Boolean(record?.geometry);
    const rows = others.map(({ layer, ref }) => {
      const entry = entries.get(ref);
      const visible = entry ? entry.visible : (this.layerState?.visible.get(layer.uid) ?? layer.visible !== false);
      const relation = entry?.relation || null;
      const queryable = layer.objectIdQueryable;
      const relationControls = queryable
        ? `<div class="briefing-layer__relation"${visible ? "" : " hidden"}>
            <label><span>Features</span><select data-slide-layer-relation${canRelate ? "" : " disabled"}><option value="">All of them</option>${SPATIAL_RELATIONSHIPS.map((type) => `<option value="${type}"${relation?.type === type ? " selected" : ""}>Only those that: ${escapeHtml(RELATION_LABELS[type])}</option>`).join("")}</select></label>
            <label${relation ? "" : " hidden"}><span>Grow the feature by</span><span class="briefing-layer__distance"><input type="number" min="0" step="any" data-slide-layer-distance value="${relation?.distance ?? ""}" placeholder="0"><select data-slide-layer-units>${DISTANCE_UNITS.map((unit) => `<option value="${unit}"${(relation?.units || "meters") === unit ? " selected" : ""}>${UNIT_LABELS[unit]}</option>`).join("")}</select></span></label>
            <label${relation?.type === "relation" ? "" : " hidden"}><span>DE-9IM pattern</span><input data-slide-layer-pattern maxlength="9" value="${escapeHtml(relation?.relationParameter || "")}" placeholder="T********"></label>
          </div>`
        : `<p class="form-note">Drawn by its service: it can be shown or hidden, not limited by feature.</p>`;
      return `<div class="briefing-layer" data-slide-layer="${escapeHtml(ref)}"><label class="briefing-layer__show"><input type="checkbox" data-slide-layer-visible${visible ? " checked" : ""}> <span>${escapeHtml(layer.title || "Layer")}</span></label>${relationControls}</div>`;
    }).join("");
    const note = canRelate
      ? `Feature limits ask each layer's service which features relate to this slide's feature${main?.title ? ` in ${escapeHtml(main.title)}` : ""}.`
      : "Feature limits need a slide about one feature (a Feature slide); here a layer can only be shown or hidden.";
    return `<fieldset class="briefing-field briefing-layers"><legend>Other layers <small>${slide.layers ? "set for this slide" : "as the map has them"}</small></legend>${rows}<p class="form-note">${note}</p>${slide.layers ? '<button type="button" class="briefing-link-button" data-slide-layers-clear>Leave the other layers as the map has them</button>' : ""}</fieldset>`;
  }

  #renderEditor(host, slide, briefing) {
    const data = this.api.data();
    const record = this.#recordFor(slide);
    const allFields = data.fields?.fields || [];
    const numericFields = data.fields?.numeric || [];
    const fieldOptions = (list, selected, { empty = "" } = {}) => `${empty ? `<option value="">${escapeHtml(empty)}</option>` : ""}${list.map((field) => `<option value="${escapeHtml(field.name)}"${field.name === selected ? " selected" : ""}>${escapeHtml(field.alias || field.name)}</option>`).join("")}`;
    const cameraStatus = slide.camera
      ? `Saved view · zoom ${Number(slide.camera.zoom.toFixed(1))}${Math.round(slide.camera.tilt) ? ` · tilt ${Math.round(slide.camera.tilt)}°` : ""}`
      : slide.fit === "feature" ? "Frames its feature" : "No map view saved";
    const blocks = slide.blocks.map((block) => {
      if (block.type === "text") {
        return `<label class="briefing-field"><span>${slide.template === "key-numbers" ? "Explanation" : "Narrative"} <small>Markdown: **bold**, *italic*, [link](https://…)</small></span><textarea rows="5" data-block-text="${block.id}" maxlength="4000">${escapeHtml(block.markdown)}</textarea></label>`;
      }
      if (block.type === "facts") {
        const selected = new Set(block.fields);
        const choices = allFields.filter((field) => field.name !== data.layer?.objectIdField);
        return `<fieldset class="briefing-field briefing-facts"><legend>Facts to show <small>${block.fields.length}/12</small></legend><div>${choices.map((field) => `<label><input type="checkbox" data-block-fact="${block.id}" value="${escapeHtml(field.name)}"${selected.has(field.name) ? " checked" : ""}${!selected.has(field.name) && block.fields.length >= 12 ? " disabled" : ""}> ${escapeHtml(field.alias || field.name)}</label>`).join("") || "<p class=\"form-note\">Load the dataset to choose fields.</p>"}</div></fieldset>`;
      }
      if (block.type === "stat") {
        const query = block.queryRef ? briefing.queries[block.queryRef] : null;
        const result = this.#slideStat(slide, block, data, briefing);
        return `<fieldset class="briefing-field briefing-stat" data-stat="${block.id}"><legend>Number</legend>
          <label><span>Label</span><input data-stat-label="${block.id}" value="${escapeHtml(block.label)}" maxlength="80" placeholder="Active projects"></label>
          <div class="briefing-stat__row"><label><span>Statistic</span><select data-stat-type="${block.id}">${STAT_TYPES.map((type) => `<option value="${type}"${type === block.stat ? " selected" : ""}>${STAT_LABELS[type]}</option>`).join("")}</select></label>
          <label><span>Of field</span><select data-stat-field="${block.id}"${block.stat === "count" ? " disabled" : ""}>${fieldOptions(numericFields, block.field, { empty: "Choose a number field" })}</select></label></div>
          <div class="briefing-stat__row"><label><span>Only where</span><select data-stat-filter-field="${block.id}">${fieldOptions(allFields, query?.field, { empty: "All features" })}</select></label>
          <label><span>Condition</span><select data-stat-filter-op="${block.id}"${query ? "" : " disabled"}>${Object.entries(FILTER_LABELS).map(([op, label]) => `<option value="${op}"${query?.op === op ? " selected" : ""}>${label}</option>`).join("")}</select></label>
          <label><span>Value</span><input data-stat-filter-value="${block.id}" value="${escapeHtml(query?.value ?? "")}"${query && query.op !== "is_not_null" ? "" : " disabled"}></label></div>
          <p class="briefing-stat__preview"><strong>${formatStat(result.value)}</strong> ${slide.dataView ? `<small>from ${result.loaded.toLocaleString()} loaded matching features; source may be incomplete</small>` : result.sample ? `<small>from ${result.loaded.toLocaleString()} loaded of ${Number(result.total).toLocaleString()} (a sample)</small>` : `<small>from ${result.loaded.toLocaleString()} features</small>`}</p>
          ${slide.blocks.filter((item) => item.type === "stat").length > 1 ? `<button type="button" class="briefing-link-button" data-stat-remove="${block.id}">Remove this number</button>` : ""}
        </fieldset>`;
      }
      if (block.type === "list") {
        return `<label class="briefing-field"><span>Next steps <small>one per line</small></span><textarea rows="5" data-block-list="${block.id}">${escapeHtml(block.items.join("\n"))}</textarea></label>${this.api.createTask ? `<button type="button" class="briefing-link-button" data-list-task="${block.id}">Send these as a field task →</button>` : ""}`;
      }
      if (block.type === "links") {
        return `<label class="briefing-field"><span>Links <small>one per line: Label | https://…</small></span><textarea rows="3" data-block-links="${block.id}">${escapeHtml(block.links.map((link) => `${link.label} | ${link.url}`).join("\n"))}</textarea></label>`;
      }
      return "";
    }).join("");
    const statCount = slide.blocks.filter((block) => block.type === "stat").length;
    host.innerHTML = `<header class="briefing-slide-editor__header"><span class="eyebrow">${escapeHtml(templateLabel(slide.template))} slide</span><button type="button" class="briefing-link-button" data-slide-preview-one="${slide.id}">Preview</button></header>
      <label class="briefing-field"><span>Title</span><input data-slide-title value="${escapeHtml(slide.title)}" maxlength="160" placeholder="Slide title"></label>
      ${["title", "map-narrative", "key-numbers"].includes(slide.template) ? `<label class="briefing-field"><span>Subtitle</span><input data-slide-subtitle value="${escapeHtml(slide.subtitle)}" maxlength="160"></label>` : ""}
      ${slide.template === "feature" ? `<p class="form-note">${record ? `Feature: <strong>${escapeHtml(data.label(record))}</strong>` : "This slide's feature is not in the loaded data."}</p>` : ""}
      ${slide.template !== "key-numbers" && slide.template !== "actions" ? `<div class="briefing-field briefing-camera"><span>Map view</span><p>${escapeHtml(cameraStatus)}</p><div><button type="button" data-slide-camera>Use current map view</button>${slide.featureId ? `<button type="button" data-slide-fit>Frame the feature</button>` : ""}${slide.camera || slide.fit ? `<button type="button" data-slide-show-map>Show</button>` : ""}</div></div>` : ""}
      ${["title", "feature", "map-narrative"].includes(slide.template) ? this.#layersSection(slide, record) : ""}
      ${blocks}
      ${slide.timeline?.frames?.length ? `<details class="briefing-field"><summary>Timeline frame details</summary><p class="form-note">Draft descriptions use loaded features; review them. A dwell time overrides playback speed for that frame.</p>${slide.timeline.frames.map((frame,index) => `<div><label class="briefing-field"><span>${escapeHtml(frame.title)} · description</span><textarea rows="2" data-frame-narrative="${index}">${escapeHtml(frame.narrative || "")}</textarea></label><label class="briefing-field"><span>Dwell in milliseconds (optional)</span><input type="number" min="250" max="60000" step="250" data-frame-dwell="${index}" value="${Number.isInteger(frame.dwellMs) ? frame.dwellMs : ""}"></label></div>`).join("")}</details>` : ""}
      ${slide.generatedBy?.template === "timeline" && !slide.timeline ? `<label class="briefing-field"><span>Timeline dwell in milliseconds (optional)</span><input type="number" min="250" max="60000" step="250" data-slide-dwell value="${Number.isInteger(slide.generatedBy.dwellMs) ? slide.generatedBy.dwellMs : ""}"></label>` : ""}
      ${slide.template === "key-numbers" && statCount < 4 ? `<button type="button" class="briefing-link-button" data-stat-add>+ Add a number</button>` : ""}
      <label class="briefing-field"><span>Presenter notes <small>not shown on the slide</small></span><textarea rows="3" data-slide-notes>${escapeHtml(slide.notes)}</textarea></label>`;
  }

  #bind(container) {
    const on = (selector, event, handler) => container.querySelectorAll(selector).forEach((element) => element.addEventListener(event, (domEvent) => handler(element, domEvent)));
    const slideId = this.selectedSlideId;
    on("[data-slide-select]", "click", (button) => {
      this.selectedSlideId = button.dataset.slideSelect;
      this.render();
      const slide = this.briefing.slides.find((item) => item.id === this.selectedSlideId);
      if (slide && (slide.camera || slide.fit)) void this.showSlideMap(slide);
    });
    on("[data-slide-add]", "click", () => this.#addTemplate(container.querySelector("[data-slide-template]").value));
    on("[data-slides-add-included]", "click", () => this.addIncluded());
    on("[data-slide-move]", "click", (button) => this.#save(moveSlide(this.briefing, button.dataset.slideId, Number(button.dataset.slideMove))));
    on("[data-slide-duplicate]", "click", (button) => this.#save(duplicateSlide(this.briefing, button.dataset.slideDuplicate)));
    on("[data-slide-hide]", "click", (button) => {
      const slide = this.briefing.slides.find((item) => item.id === button.dataset.slideHide);
      if (slide) this.#save(updateSlide(this.briefing, slide.id, { hidden: !slide.hidden }));
    });
    on("[data-slide-delete]", "click", (button) => {
      const briefing = this.briefing;
      const index = briefing.slides.findIndex((slide) => slide.id === button.dataset.slideDelete);
      const slide = briefing.slides[index];
      if (!slide || !globalThis.confirm?.(`Delete “${slide.title || "Untitled slide"}”? This cannot be undone.`)) return;
      if (this.selectedSlideId === slide.id) this.selectedSlideId = briefing.slides[index + 1]?.id || briefing.slides[index - 1]?.id || null;
      this.#save(removeSlide(briefing, slide.id));
    });
    on("[data-slides-transition]", "change", (select) => this.#save({ ...this.briefing, transition: select.value }, { render: false }));
    on("[data-slides-preview]", "click", () => this.openPlayer(this.briefing.slides.find((slide) => !slide.hidden)?.id));
    on("[data-slides-share]", "click", () => this.api.share?.());
    on("[data-slides-tour]", "click", () => this.#toTour());
    on("[data-series-preview]", "click", () => {
      const output = container.querySelector("[data-series-results]");
      try {
        const data = this.api.data();
        const records = data.useAll ? data.visibleRecords : data.records.filter((record) => data.selectedIds.has(this.#idOf(record)));
        const preview = previewFilterSeries({ field: container.querySelector("[data-series-field]").value, fields: data.fields?.fields || [], records, availableSlides: MAX_SLIDES - this.briefing.slides.length });
        output.innerHTML = `<p><strong>${preview.subsets.length} potential slides</strong> from ${preview.recordCount} loaded, included features.</p><ul>${preview.subsets.map((subset) => `<li>${escapeHtml(subset.title)} — ${subset.count} loaded feature${subset.count === 1 ? "" : "s"}</li>`).join("")}</ul>${preview.warnings.map((warning) => `<p class="form-note">${escapeHtml(warning)}</p>`).join("")}`;
      } catch (error) { output.textContent = error.message; }
    });
    on("[data-series-create]", "click", () => {
      try {
        const data = this.api.data();
        const records = data.useAll ? data.visibleRecords : data.records.filter((record) => data.selectedIds.has(this.#idOf(record)));
        const { briefing, preview } = generateFilterSeries({ briefing: this.briefing, field: container.querySelector("[data-series-field]").value, fields: data.fields?.fields || [], records, layerRef: briefingLayerRef(this.api.mapController, data.layer), camera: this.#currentCamera() });
        this.selectedSlideId = briefing.slides[this.briefing.slides.length]?.id || this.selectedSlideId;
        this.#save(briefing);
        this.api.notify?.(`Added ${preview.subsets.length} filtered slides. Categories are based on loaded, included features.`);
      } catch (error) { container.querySelector("[data-series-results]").textContent = error.message; }
    });
    const gridOptions = () => {
      const data = this.api.data();
      return { records:data.useAll ? data.visibleRecords : data.records.filter(record => data.selectedIds.has(this.#idOf(record))), rows:container.querySelector('[data-grid-rows]').value, columns:container.querySelector('[data-grid-columns]').value, order:container.querySelector('[data-grid-order]').value, skipEmpty:container.querySelector('[data-grid-skip]').checked };
    };
    on('[data-grid-preview]', 'click', () => {
      const output=container.querySelector('[data-grid-results]');
      try {
        const preview=previewGridAtlas({...gridOptions(),availableSlides:MAX_SLIDES-this.briefing.slides.length});
        output.innerHTML=`<p><strong>${preview.cells.length} slides</strong> · ${preview.recordCount} loaded points</p><ol>${preview.cells.map(cell=>`<li>${escapeHtml(cell.id)} — ${cell.count} assigned</li>`).join('')}</ol>`;
      } catch (error) { output.textContent=error.message; }
    });
    on('[data-grid-create]', 'click', () => {
      try {
        const original=this.briefing;
        const {briefing,preview}=generateGridAtlas({...gridOptions(),briefing:original,layerRef:briefingLayerRef(this.api.mapController,this.api.data().layer),camera:this.#currentCamera()});
        if (!preview.cells.length) throw new Error('No cells to generate.');
        this.selectedSlideId=briefing.slides[original.slides.length].id;
        this.#save(briefing);
        this.api.notify?.(`Added ${preview.cells.length} Grid Atlas slides. Counts use loaded points.`);
      } catch (error) { container.querySelector('[data-grid-results]').textContent=error.message; }
    });
    const optionsMessage = (count, presentation) => presentation === 'single-slide' ? `Added an interactive timeline with ${count} frames.` : `Added ${count} timeline slides. Counts were previewed from loaded features only.`;
    const timelineOptions = () => {
      const data = this.api.data();
      const field = container.querySelector("[data-timeline-field]");
      const kind = field.selectedOptions[0]?.dataset.kind || 'year';
      return { kind, timeZone:container.querySelector("[data-timeline-timezone]").value.trim() || "UTC", stat:container.querySelector("[data-timeline-stat]").value, statField:container.querySelector("[data-timeline-stat-field]").value, narration:container.querySelector("[data-timeline-narration]").checked, presentationMode:container.querySelector("[data-timeline-presentation]").value, field: field.value, endField:container.querySelector("[data-timeline-end-field]").value, fields: data.fields?.fields || [], records: data.useAll ? data.visibleRecords : data.records.filter((record) => data.selectedIds.has(this.#idOf(record))), start: container.querySelector(kind === 'date' ? "[data-timeline-date-start]" : "[data-timeline-start]").value, end: container.querySelector(kind === 'date' ? "[data-timeline-date-end]" : "[data-timeline-end]").value, step: container.querySelector("[data-timeline-step]").value, unit:container.querySelector("[data-timeline-unit]").value, rolling:container.querySelector("[data-timeline-rolling]").value, mode: container.querySelector("[data-timeline-mode]").value };
    };
    const syncTimelineOptions = () => {
      const field = container.querySelector("[data-timeline-field]");
      const isDate = field.selectedOptions[0]?.dataset.kind === 'date';
      container.querySelector("[data-timeline-years]").hidden = isDate;
      container.querySelector("[data-timeline-dates]").hidden = !isDate;
      const mode = container.querySelector("[data-timeline-mode]").value;
      container.querySelector("[data-timeline-rolling-wrap]").hidden = mode !== 'rolling';
      container.querySelector("[data-timeline-end-field-wrap]").hidden = mode !== 'validity';
    };
    on("[data-timeline-stat]", "change", select => { container.querySelector("[data-timeline-stat-field-wrap]").hidden = !select.value; });
    on("[data-timeline-field]", "change", syncTimelineOptions);
    on("[data-timeline-mode]", "change", syncTimelineOptions);
    on("[data-timeline-preview]", "click", async () => {
      const output = container.querySelector("[data-timeline-results]");
      const epoch = ++this.timelinePreviewEpoch;
      try {
        const options = timelineOptions();
        const preview = (options.kind === "date" ? previewDateTimeline : previewTimeline)({ ...options, availableSlides: options.presentationMode === "single-slide" && this.briefing.slides.length < MAX_SLIDES ? MAX_SLIDES : MAX_SLIDES - this.briefing.slides.length });
        const source = container.querySelector("[data-timeline-source]").checked;
        let frames = preview.frames;
        if (source) {
          output.textContent = "Querying source for timeline statistics…";
          const data = this.api.data();
          const url = briefingLayerRef(this.api.mapController, data.layer);
          if (!url) throw new Error('No source layer is available.');
          const requests = frames.map(frame => ({ url, filter:frame.filter, fields:options.fields, baseWhere:data.layer?.where || '', stat:options.stat, statField:options.statField }));
          const results = await this.timelineSourceCache.prefetch(requests);
          if (epoch !== this.timelinePreviewEpoch || !container.isConnected) return;
          frames = frames.map((frame, index) => ({ ...frame, ...results[index] }));
        }
        const max = Math.max(1, ...frames.map(frame => frame.count));
        output.innerHTML = `<p><strong>${frames.length} frames</strong> · ${source ? "Complete source, with layer filter" : `${preview.recordCount} loaded, included features`}</p><div class="timeline-preview-chart" aria-label="Feature counts by timeline frame">${frames.map(frame => `<div class="timeline-preview-chart__row"><span>${escapeHtml(frame.title)}</span><span class="timeline-preview-chart__track" aria-hidden="true"><span style="width:${Math.max(0, Math.min(100, frame.count / max * 100))}%"></span></span><strong>${frame.count.toLocaleString()}</strong>${source && options.stat ? `<small>${escapeHtml(options.stat)}: ${frame.value == null ? '—' : Number(frame.value).toLocaleString()}</small>` : ''}</div>`).join("")}</div>${source ? '<p class="form-note">Source results are cached for up to one minute. Slide statistics and draft descriptions still use loaded features.</p>' : preview.warnings.map(warning => `<p class="form-note">${escapeHtml(warning)}</p>`).join("")}`;
      } catch (error) { if (epoch === this.timelinePreviewEpoch) output.textContent = error.message; }
    });
    on("[data-timeline-create]", "click", () => {
      try {
        const original = this.briefing;
        const options = timelineOptions();
        const {briefing, preview} = generateTimeline({...options, briefing:original, layerRef:briefingLayerRef(this.api.mapController, this.api.data().layer), camera:this.#currentCamera()});
        this.selectedSlideId = briefing.slides[original.slides.length].id;
        this.#save(briefing);
        this.api.notify?.(optionsMessage(preview.frames.length, options.presentationMode));
      } catch (error) { container.querySelector("[data-timeline-results]").textContent = error.message; }
    });
    on("[data-slides-generate]", "click", () => this.api.generate());
    on("[data-slides-ai]", "click", async (button) => {
      button.disabled = true;
      button.textContent = "Writing…";
      await this.api.describeWithAi?.();
    });
    on("[data-list-task]", "click", (button) => {
      const slide = this.briefing.slides.find((item) => item.id === slideId);
      const block = slide?.blocks.find((item) => item.id === button.dataset.listTask);
      // Typing saves after a pause, so read the box itself for the latest items.
      const typed = container.querySelector(`[data-block-list="${button.dataset.listTask}"]`)?.value.split("\n").map((item) => item.trim()).filter(Boolean);
      const items = typed?.length ? typed : block?.items || [];
      if (!items.length) return this.api.notify?.("Write the next steps first, one per line.");
      if (slide) this.#sendAsTask(slide, items);
    });
    on("[data-slide-preview-one]", "click", (button) => this.openPlayer(button.dataset.slidePreviewOne));
    on("[data-slide-title]", "input", (input) => {
      const item = container.querySelector(".briefing-slide-item.is-selected strong");
      if (item) item.textContent = input.value || "Untitled slide";
      this.#saveSoon((briefing) => updateSlide(briefing, slideId, { title: input.value }));
    });
    on("[data-slide-subtitle]", "input", (input) => this.#saveSoon((briefing) => updateSlide(briefing, slideId, { subtitle: input.value })));
    on("[data-slide-notes]", "input", (input) => this.#saveSoon((briefing) => updateSlide(briefing, slideId, { notes: input.value })));
    const validatedDwell = input => {
      const value = Number(input.value);
      if (!input.value) return null;
      if (!Number.isInteger(value) || value < 250 || value > 60000) { this.api.notify?.("Dwell time must be between 250 and 60,000 milliseconds."); return undefined; }
      return value;
    };
    on("[data-frame-dwell]", "change", input => {
      const value = validatedDwell(input); if (value === undefined) return;
      const briefing = this.briefing, slide = briefing.slides.find(item => item.id === slideId);
      if (!slide?.timeline?.frames) return;
      const frames = slide.timeline.frames.map((frame,index) => index === Number(input.dataset.frameDwell) ? {...frame, dwellMs:value} : frame);
      this.#save(updateSlide(briefing,slideId,{timeline:{...slide.timeline,frames}}), {render:false});
    });
    on("[data-slide-dwell]", "change", input => {
      const value = validatedDwell(input); if (value === undefined) return;
      const briefing = this.briefing, slide = briefing.slides.find(item => item.id === slideId);
      if (slide?.generatedBy) this.#save(updateSlide(briefing,slideId,{generatedBy:{...slide.generatedBy,dwellMs:value}}), {render:false});
    });
    on("[data-frame-narrative]", "input", input => this.#saveSoon(briefing => {
      const slide = briefing.slides.find(item => item.id === slideId);
      if (!slide?.timeline?.frames) return briefing;
      const frames = slide.timeline.frames.map((frame,index) => index === Number(input.dataset.frameNarrative) ? {...frame, narrative:input.value.slice(0,2000)} : frame);
      return updateSlide(briefing, slideId, {timeline:{...slide.timeline,frames}});
    }));
    on("[data-block-text]", "input", (input) => this.#saveSoon((briefing) => updateBlock(briefing, slideId, input.dataset.blockText, { markdown: input.value })));
    on("[data-block-list]", "input", (input) => this.#saveSoon((briefing) => updateBlock(briefing, slideId, input.dataset.blockList, { items: input.value.split("\n").map((line) => line.trim()).filter(Boolean) })));
    on("[data-block-links]", "change", (input) => {
      const links = input.value.split("\n").map((line) => {
        const [label, url] = line.includes("|") ? line.split("|") : [line, line];
        return { label: label.trim(), url: safeUrl(url) };
      }).filter((link) => link.url);
      this.#save(updateBlock(this.briefing, slideId, input.dataset.blockLinks, { links }));
    });
    on("[data-block-fact]", "change", (input) => {
      const block = this.briefing.slides.find((item) => item.id === slideId)?.blocks.find((item) => item.id === input.dataset.blockFact);
      if (!block) return;
      const fields = input.checked ? [...block.fields, input.value] : block.fields.filter((field) => field !== input.value);
      this.#save(updateBlock(this.briefing, slideId, block.id, { fields }));
    });
    on("[data-slide-camera]", "click", () => {
      const camera = this.#currentCamera();
      if (!camera) return this.api.notify?.("The map is not ready yet.");
      this.#save(updateSlide(this.briefing, slideId, { camera, fit: null }));
      this.api.notify?.("Saved the current map view to this slide.");
    });
    // Other layers: any change records every row, so the slide says exactly what shows.
    const saveLayers = () => {
      const layers = [...container.querySelectorAll("[data-slide-layer]")].map((row) => {
        const type = row.querySelector("[data-slide-layer-relation]")?.value || "";
        const distance = Number(row.querySelector("[data-slide-layer-distance]")?.value);
        const relation = type ? {
          type,
          ...(distance > 0 ? { distance, units: row.querySelector("[data-slide-layer-units]")?.value || "meters" } : {}),
          ...(type === "relation" ? { relationParameter: row.querySelector("[data-slide-layer-pattern]")?.value.trim() || "" } : {}),
        } : null;
        return { layer: row.dataset.slideLayer, visible: row.querySelector("[data-slide-layer-visible]").checked, ...(relation ? { relation } : {}) };
      });
      this.#save(updateSlide(this.briefing, slideId, { layers }));
      const slide = this.briefing.slides.find((item) => item.id === slideId);
      if (slide) void this.applySlideLayers(slide);
    };
    on("[data-slide-layer] input, [data-slide-layer] select", "change", saveLayers);
    on("[data-slide-layers-clear]", "click", () => {
      this.#save(updateSlide(this.briefing, slideId, { layers: undefined }));
      void this.restoreLayers();
    });
    on("[data-slide-fit]", "click", () => this.#save(updateSlide(this.briefing, slideId, { camera: null, fit: "feature" })));
    on("[data-slide-show-map]", "click", () => {
      const slide = this.briefing.slides.find((item) => item.id === slideId);
      if (slide) void this.showSlideMap(slide);
    });
    // Numbers: each statistic keeps its own named query, so the same filter is reused wherever it is shown.
    on("[data-stat-label]", "input", (input) => this.#saveSoon((briefing) => updateBlock(briefing, slideId, input.dataset.statLabel, { label: input.value })));
    on("[data-stat-type]", "change", (select) => this.#save(updateBlock(this.briefing, slideId, select.dataset.statType, { stat: select.value })));
    on("[data-stat-field]", "change", (select) => this.#save(updateBlock(this.briefing, slideId, select.dataset.statField, { field: select.value || null })));
    const setQuery = (blockId, change) => {
      const briefing = this.briefing;
      const block = briefing.slides.find((item) => item.id === slideId)?.blocks.find((item) => item.id === blockId);
      if (!block) return;
      const name = block.queryRef || `q-${blockId}`;
      const next = change(briefing.queries[name] || null);
      const queries = { ...briefing.queries };
      if (next) queries[name] = next;
      else delete queries[name];
      this.#save(updateBlock({ ...briefing, queries }, slideId, blockId, { queryRef: next ? name : null }));
    };
    on("[data-stat-filter-field]", "change", (select) => setQuery(select.dataset.statFilterField, (query) => (select.value ? { op: query?.op || "eq", field: select.value, value: query?.value ?? "" } : null)));
    on("[data-stat-filter-op]", "change", (select) => setQuery(select.dataset.statFilterOp, (query) => (query ? { ...query, op: select.value } : null)));
    on("[data-stat-filter-value]", "change", (input) => setQuery(input.dataset.statFilterValue, (query) => (query ? { ...query, value: input.value } : null)));
    on("[data-stat-add]", "click", () => {
      const slide = this.briefing.slides.find((item) => item.id === slideId);
      if (!slide) return;
      const textIndex = slide.blocks.findIndex((block) => block.type === "text");
      const blocks = [...slide.blocks];
      blocks.splice(textIndex >= 0 ? textIndex : blocks.length, 0, { type: "stat", stat: "count", field: null, queryRef: null, label: "" });
      this.#save(updateSlide(this.briefing, slideId, { blocks }));
    });
    on("[data-stat-remove]", "click", (button) => {
      const slide = this.briefing.slides.find((item) => item.id === slideId);
      if (slide) this.#save(updateSlide(this.briefing, slideId, { blocks: slide.blocks.filter((block) => block.id !== button.dataset.statRemove) }));
    });
  }

  #slideStat(slide, block, data, briefing) {
    let records = data.records;
    if (slide.dataView) {
      records = data.useAll ? (data.visibleRecords || data.records) : data.records.filter(record => data.selectedIds?.has(this.#idOf(record)));
      try {
        const where = seriesWhere(slide.dataView.filter, data.fields?.fields || data.layer?.fields || []);
        const matches = compileWhere(where);
        records = records.filter(record => matches(record.attributes || {}));
      } catch { records = []; }
    }
    const result = computeStat(block, records, { queries:briefing.queries, idField:data.layer?.objectIdField, total:data.total });
    // A local subset count is never a claim about all features in the source.
    return slide.dataView ? {...result, sample:true} : result;
  }

  /** The slide as it is presented: shared by the preview player now, and later by mobile cards and PDF. */
  slideHtml(slide, { index = 0, count = 1 } = {}) {
    const data = this.api.data();
    const briefing = this.briefing;
    const record = this.#recordFor(slide);
    const body = slide.blocks.map((block) => {
      if (block.type === "text" && block.markdown.trim()) return `<div class="briefing-slide__text">${renderMarkdown(block.markdown)}</div>`;
      if (block.type === "facts" && record) {
        const field = (name) => data.fields?.fields?.find((item) => item.name === name);
        const rows = (block.fields.length ? block.fields : this.#defaultFacts(record)).filter((name) => record.attributes?.[name] != null && record.attributes[name] !== "")
          .map((name) => `<div><dt>${escapeHtml(field(name)?.alias || name)}</dt><dd>${escapeHtml(this.api.formatValue ? this.api.formatValue(record.attributes[name], field(name), name) : record.attributes[name])}</dd></div>`).join("");
        return rows ? `<dl class="briefing-slide__facts">${rows}</dl>` : "";
      }
      if (block.type === "list" && block.items.length) return `<ul class="briefing-slide__list">${block.items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
      if (block.type === "links" && block.links.length) return `<p class="briefing-slide__links">${block.links.map((link) => `<a href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.label || link.url)}</a>`).join("")}</p>`;
      return "";
    }).join("");
    const stats = slide.blocks.filter((block) => block.type === "stat").map((block) => {
      const result = this.#slideStat(slide, block, data, briefing);
      return `<div class="briefing-slide__stat"><strong>${formatStat(result.value)}</strong><span>${escapeHtml(block.label || STAT_LABELS[block.stat])}</span>${result.sample ? "<small>sample of loaded features</small>" : ""}</div>`;
    }).join("");
    const grid = slide.generatedBy;
    const locator = grid?.template === 'grid-atlas' && Number.isInteger(grid.rows) && Number.isInteger(grid.columns) && grid.rows > 0 && grid.rows <= 20 && grid.columns > 0 && grid.columns <= 20 && Number.isInteger(grid.row) && grid.row >= 0 && grid.row < grid.rows && Number.isInteger(grid.column) && grid.column >= 0 && grid.column < grid.columns
      ? `<svg class="briefing-grid-locator" viewBox="0 0 ${grid.columns} ${grid.rows}" role="img" aria-label="Locator: row ${grid.row+1} of ${grid.rows}, column ${grid.column+1} of ${grid.columns}">${Array.from({length:grid.rows}, (_,row) => Array.from({length:grid.columns}, (_,column) => `<rect x="${column}" y="${row}" width="1" height="1" fill="${row === grid.row && column === grid.column ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width=".06"/>`).join('')).join('')}</svg>` : '';
    return `<article class="briefing-slide briefing-slide--${slide.template}">
      <span class="briefing-slide__eyebrow">${escapeHtml(data.title || "Briefing")} · ${index + 1} / ${count}</span>
      <h2>${escapeHtml(slide.title || "Untitled slide")}</h2>
      ${slide.subtitle ? `<p class="briefing-slide__subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
      ${locator}
      ${stats ? `<div class="briefing-slide__stats">${stats}</div>` : ""}
      ${body}
      ${(slide.frameNarrative ?? slide.timeline?.frames?.[0]?.narrative) ? `<div class="briefing-slide__text">${renderMarkdown(slide.frameNarrative ?? slide.timeline.frames[0].narrative)}</div>` : ""}
      ${slide.featureId && !record ? `<p class="briefing-slide__warning">This slide's feature is not in the loaded data.</p>` : ""}
    </article>`;
  }

  /**
   * Hands a slide's action items to Field tasks as a draft: steps from the list,
   * placed at the slide's feature or saved view (or the map centre).
   */
  #sendAsTask(slide, items) {
    const data = this.api.data();
    const record = this.#recordFor(slide);
    const point = record?.geometry ? this.api.mapController.geographicCoordinates?.(record.geometry) : null;
    const center = slide.camera?.center || this.api.mapController.getViewState?.()?.center || [];
    this.api.createTask({
      title: slide.title || data.title,
      notes: `From the briefing “${data.title}”.`,
      steps: items,
      latitude: point?.latitude ?? center[1],
      longitude: point?.longitude ?? center[0],
      location: record ? data.label(record) : "",
    });
  }

  /** Each visible slide with a place (saved view or feature) becomes a tour chapter. */
  #toTour() {
    const places = this.briefing.slides.filter((slide) => !slide.hidden).map((slide) => {
      const content = this.slideContent(slide);
      const body = [slide.subtitle, ...content.paragraphs, ...content.facts.map(([label, value]) => `${label}: ${value}`)].filter(Boolean).join("\n").slice(0, 600);
      if (slide.camera) return { title: slide.title, body, longitude: slide.camera.center[0], latitude: slide.camera.center[1], zoom: slide.camera.zoom };
      const record = this.#recordFor(slide);
      const point = record?.geometry ? this.api.mapController.geographicCoordinates?.(record.geometry) : null;
      return point ? { title: slide.title, body, ...point, zoom: 15 } : null;
    }).filter(Boolean);
    if (!places.length) return this.api.notify?.("Give a slide a map view or a feature to turn it into a tour chapter.");
    this.api.createTour(places, { title: this.api.data().title });
  }

  /** A slide's content as plain data, for the PDF handout. */
  slideContent(slide) {
    const data = this.api.data();
    const briefing = this.briefing;
    const record = this.#recordFor(slide);
    const field = (name) => data.fields?.fields?.find((item) => item.name === name);
    const content = { id: slide.id, title: slide.title, subtitle: slide.subtitle, stats: [], facts: [], paragraphs: [], list: [], links: [], notes: slide.notes, missing: Boolean(slide.featureId && !record) };
    for (const block of slide.blocks) {
      if (block.type === "text" && block.markdown.trim()) content.paragraphs.push(markdownToText(block.markdown));
      if (block.type === "facts" && record) {
        for (const name of block.fields.length ? block.fields : this.#defaultFacts(record)) {
          const value = record.attributes?.[name];
          if (value == null || value === "") continue;
          content.facts.push([field(name)?.alias || name, String(this.api.formatValue ? this.api.formatValue(value, field(name), name) : value)]);
        }
      }
      if (block.type === "list") content.list.push(...block.items);
      if (block.type === "links") content.links.push(...block.links);
      if (block.type === "stat") {
        const result = this.#slideStat(slide, block, data, briefing);
        content.stats.push({ value: formatStat(result.value), label: block.label || STAT_LABELS[block.stat], sample: result.sample });
      }
    }
    const frameNarrative = slide.frameNarrative ?? slide.timeline?.frames?.[0]?.narrative;
    if (frameNarrative) content.paragraphs.push(markdownToText(frameNarrative));
    return content;
  }

  /** Where the map goes for a slide (a goTo target), or null when the slide has no map. */
  slideTarget(slide) {
    if (!slideHasMap(slide)) return null;
    if (slide.camera) return { center: slide.camera.center, zoom: slide.camera.zoom, heading: slide.camera.heading, tilt: slide.camera.tilt };
    const geometry = this.#recordFor(slide)?.geometry;
    if (!geometry) return null;
    return { geometry, fit: "feature" };
  }

  /**
   * A landscape PDF handout of the visible slides, with map snapshots taken
   * from the live map. `link` is the briefing's share link for the QR code.
   */
  async createPdf({ link = null, qr = true, skin = null, onProgress = () => {}, timelineFrames = "initial", selectedFrames = [] } = {}) {
    const slides = expandTimelinePdfSlides(this.briefing.slides, {mode:timelineFrames, selected:selectedFrames});
    if (!slides.length) throw new Error("Add a visible slide before making a PDF.");
    const { mapController } = this.api;
    const targets = slides.map((slide) => this.slideTarget(slide));
    const withMaps = targets.filter(Boolean);
    const mapSlides = slides.filter((slide, index) => targets[index]);
    let captured;
    try {
      captured = withMaps.length
      ? await mapController.captureViews(withMaps, {
        aspect: 1.02,
        prepare: (index) => this.showSlideMap(mapSlides[index]),
        onProgress: (index, total) => onProgress(`Capturing map ${index + 1} of ${total}…`),
      })
      : [];
    } finally { await this.restoreLayers(); }
    let next = 0;
    const images = targets.map((target) => (target ? captured[next++] : null));
    onProgress("Writing PDF…");
    const title = this.api.data().title;
    const blob = await briefingPdf({ title, skin, link, qr, slides: slides.map((slide, index) => ({ content: this.slideContent(slide), mapImage: images[index] })) });
    return new File([blob], `${briefingFileStem(title)}.pdf`, { type: "application/pdf" });
  }

  /** Presents the visible slides: a 16:9 stage on desktop, swipeable cards on phones. */
  openPlayer(startId = null) {
    if (!this.player.open(startId)) this.api.notify?.("Every slide is hidden.");
  }

  closePlayer() {
    this.player.close();
  }
}
