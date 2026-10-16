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
} from "./briefing-document.js?v=0.27.0";
import { renderMarkdown } from "./markdown.js?v=0.18.2";
import { BriefingPlayer, slideHasMap } from "./briefing-player.js?v=0.30.1";
import { briefingFileStem, briefingPdf, markdownToText } from "./briefing-pdf.js?v=0.23.0";
import { featureId } from "./presentation-query.js?v=0.18.2";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const templateLabel = (id) => SLIDE_TEMPLATES.find((template) => template.id === id)?.label || "Slide";
const STAT_LABELS = { count: "Count", sum: "Sum", average: "Average", min: "Minimum", max: "Maximum" };
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
    this.player = new BriefingPlayer({
      getSlides: () => this.briefing.slides.filter((slide) => !slide.hidden),
      slideHtml: (slide, options) => this.slideHtml(slide, options),
      showSlide: (slide) => this.showSlideMap(slide),
      mapController: api.mapController,
      compact: () => api.compact?.() ?? false,
      title: () => api.data().title,
    });
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

  #defaultFacts(record) {
    const { layer } = this.api.data();
    return Object.entries(record?.attributes || {})
      .filter(([key, value]) => value != null && value !== "" && key !== layer?.objectIdField)
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

  #addIncluded() {
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
    const view = this.api.mapController.view;
    const camera = view?.camera;
    const center = view?.center;
    if (!center || !Number.isFinite(center.longitude)) return null;
    return {
      center: [Number(center.longitude.toFixed(6)), Number(center.latitude.toFixed(6))],
      zoom: Number((view.zoom ?? 12).toFixed(2)),
      heading: Number((camera?.heading ?? 0).toFixed(1)),
      tilt: Number((camera?.tilt ?? 0).toFixed(1)),
    };
  }

  /** Moves the map to a slide's saved view, or frames its feature. */
  async showSlideMap(slide) {
    const { mapController } = this.api;
    const record = this.#recordFor(slide);
    try {
      if (slide.camera) {
        await mapController.view?.goTo({ center: slide.camera.center, zoom: slide.camera.zoom, heading: slide.camera.heading, tilt: slide.camera.tilt });
      } else if (slide.fit === "feature" && record?.geometry) {
        await mapController.goToFeature(record);
      }
      if (record) await mapController.highlightFeature?.(record, { pulse: false });
      else mapController.clearFeatureHighlight?.();
    } catch (error) {
      if (error?.name !== "AbortError") this.api.notify?.(error.message);
    }
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
        <div class="briefing-slides__add">
          <label><span>Add a slide</span><select data-slide-template>${SLIDE_TEMPLATES.filter((template) => template.id !== "feature").map((template) => `<option value="${template.id}">${escapeHtml(template.label)}</option>`).join("")}</select></label>
          <button type="button" data-slide-add>Add</button>
        </div>
        <button type="button" class="briefing-slides__included" data-slides-add-included${includedCount ? "" : " disabled"}>${includedCount ? `Add ${includedCount} included feature${includedCount === 1 ? "" : "s"} as slides` : included.length ? "Every included feature has a slide" : "Include features to add them as slides"}</button>
        ${briefing.slides.length ? `<ol class="briefing-slide-list" aria-label="Briefing slides">${list}</ol>` : `<p class="briefing-slides__empty">No slides yet. Make them from the map in one step, add a title slide, or turn the features you included into slides. A briefing without slides works exactly as before.</p>`}
        ${issues.length ? `<details class="briefing-slides__issues"><summary>${issues.length} thing${issues.length === 1 ? "" : "s"} to check</summary><ul>${issues.map((issue) => `<li class="is-${issue.level}"><button type="button" data-slide-select="${issue.slideId}">${escapeHtml(issue.message)}</button></li>`).join("")}</ul></details>` : ""}
        ${briefing.slides.length ? `<div class="briefing-slides__actions"><button type="button" class="briefing-slides__present" data-slides-preview data-mobile-bar="primary" data-bar-label="Preview slides">Preview slides</button><button type="button" data-slides-share data-mobile-bar data-bar-label="Share">Share &amp; PDF</button></div>${this.api.createTour ? `<button type="button" class="briefing-link-button" data-slides-tour>Make a guided tour from these slides →</button>` : ""}` : ""}
      </div>
      <section class="briefing-slide-editor" data-slide-editor aria-label="Selected slide settings"></section>
    </div>`;
    const slide = briefing.slides.find((item) => item.id === this.selectedSlideId);
    if (slide) this.#renderEditor(container.querySelector("[data-slide-editor]"), slide, briefing);
    this.#bind(container);
  }

  #renderEditor(host, slide, briefing) {
    const data = this.api.data();
    const record = this.#recordFor(slide);
    const allFields = data.fields?.fields || [];
    const numericFields = data.fields?.numeric || [];
    const fieldOptions = (list, selected, { empty = "" } = {}) => `${empty ? `<option value="">${escapeHtml(empty)}</option>` : ""}${list.map((field) => `<option value="${escapeHtml(field.name)}"${field.name === selected ? " selected" : ""}>${escapeHtml(field.alias || field.name)}</option>`).join("")}`;
    const cameraStatus = slide.camera
      ? `Saved view · zoom ${slide.camera.zoom}${slide.camera.tilt ? ` · tilt ${slide.camera.tilt}°` : ""}`
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
        const result = computeStat(block, data.records, { queries: briefing.queries, idField: data.layer?.objectIdField, total: data.total });
        return `<fieldset class="briefing-field briefing-stat" data-stat="${block.id}"><legend>Number</legend>
          <label><span>Label</span><input data-stat-label="${block.id}" value="${escapeHtml(block.label)}" maxlength="80" placeholder="Active projects"></label>
          <div class="briefing-stat__row"><label><span>Statistic</span><select data-stat-type="${block.id}">${STAT_TYPES.map((type) => `<option value="${type}"${type === block.stat ? " selected" : ""}>${STAT_LABELS[type]}</option>`).join("")}</select></label>
          <label><span>Of field</span><select data-stat-field="${block.id}"${block.stat === "count" ? " disabled" : ""}>${fieldOptions(numericFields, block.field, { empty: "Choose a number field" })}</select></label></div>
          <div class="briefing-stat__row"><label><span>Only where</span><select data-stat-filter-field="${block.id}">${fieldOptions(allFields, query?.field, { empty: "All features" })}</select></label>
          <label><span>Condition</span><select data-stat-filter-op="${block.id}"${query ? "" : " disabled"}>${Object.entries(FILTER_LABELS).map(([op, label]) => `<option value="${op}"${query?.op === op ? " selected" : ""}>${label}</option>`).join("")}</select></label>
          <label><span>Value</span><input data-stat-filter-value="${block.id}" value="${escapeHtml(query?.value ?? "")}"${query && query.op !== "is_not_null" ? "" : " disabled"}></label></div>
          <p class="briefing-stat__preview"><strong>${formatStat(result.value)}</strong> ${result.sample ? `<small>from ${result.loaded.toLocaleString()} loaded of ${Number(result.total).toLocaleString()} (a sample)</small>` : `<small>from ${result.loaded.toLocaleString()} features</small>`}</p>
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
      ${blocks}
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
    on("[data-slides-add-included]", "click", () => this.#addIncluded());
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
    on("[data-slides-preview]", "click", () => this.openPlayer(this.briefing.slides.find((slide) => !slide.hidden)?.id));
    on("[data-slides-share]", "click", () => this.api.share?.());
    on("[data-slides-tour]", "click", () => this.#toTour());
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
      const result = computeStat(block, data.records, { queries: briefing.queries, idField: data.layer?.objectIdField, total: data.total });
      return `<div class="briefing-slide__stat"><strong>${formatStat(result.value)}</strong><span>${escapeHtml(block.label || STAT_LABELS[block.stat])}</span>${result.sample ? "<small>sample of loaded features</small>" : ""}</div>`;
    }).join("");
    return `<article class="briefing-slide briefing-slide--${slide.template}">
      <span class="briefing-slide__eyebrow">${escapeHtml(data.title || "Briefing")} · ${index + 1} / ${count}</span>
      <h2>${escapeHtml(slide.title || "Untitled slide")}</h2>
      ${slide.subtitle ? `<p class="briefing-slide__subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
      ${stats ? `<div class="briefing-slide__stats">${stats}</div>` : ""}
      ${body}
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
    const center = slide.camera?.center || [this.api.mapController.view?.center?.longitude, this.api.mapController.view?.center?.latitude];
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
        const result = computeStat(block, data.records, { queries: briefing.queries, idField: data.layer?.objectIdField, total: data.total });
        content.stats.push({ value: formatStat(result.value), label: block.label || STAT_LABELS[block.stat], sample: result.sample });
      }
    }
    return content;
  }

  /** Where the map goes for a slide (a goTo target), or null when the slide has no map. */
  slideTarget(slide) {
    if (!slideHasMap(slide)) return null;
    if (slide.camera) return { center: slide.camera.center, zoom: slide.camera.zoom, heading: slide.camera.heading, tilt: slide.camera.tilt };
    const geometry = this.#recordFor(slide)?.geometry;
    if (!geometry) return null;
    if (geometry.type === "point") return { target: geometry, zoom: 15, tilt: 0 };
    return { target: geometry.extent?.clone?.().expand?.(1.25) ?? geometry, tilt: 0 };
  }

  /**
   * A landscape PDF handout of the visible slides, with map snapshots taken
   * from the live map. `link` is the briefing's share link for the QR code.
   */
  async createPdf({ link = null, qr = true, skin = null, onProgress = () => {} } = {}) {
    const slides = this.briefing.slides.filter((slide) => !slide.hidden);
    if (!slides.length) throw new Error("Add a visible slide before making a PDF.");
    const { mapController } = this.api;
    const targets = slides.map((slide) => this.slideTarget(slide));
    const withMaps = targets.filter(Boolean);
    const mapSlides = slides.filter((slide, index) => targets[index]);
    const captured = withMaps.length
      ? await mapController.captureViews(withMaps, {
        aspect: 1.02,
        prepare: (index) => this.showSlideMap(mapSlides[index]),
        onProgress: (index, total) => onProgress(`Capturing map ${index + 1} of ${total}…`),
      })
      : [];
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
