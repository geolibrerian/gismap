// Plays a briefing's slides. Desktop: a 16:9 frame over a full-screen live map,
// with thumbnails, presenter notes and fullscreen. Phones: full-screen cards that
// swipe vertically, with the map showing through each card and a tap-to-explore
// mode. Both read the same slides; viewing never changes the saved briefing.

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
// Slides that show the map get a content column and a window onto the live map.
const MAP_TEMPLATES = new Set(["feature", "map-narrative", "title", "cinematic"]);
const hasMap = (slide) => MAP_TEMPLATES.has(slide.template) && Boolean(slide.camera || slide.fit);
const playerSettings = (value = {}) => ({
  basemap: typeof value?.basemap === "string" && value.basemap ? value.basemap : null,
  animations: value?.animations !== false,
  motion: value?.motion === "fly" ? "fly" : "pan",
  mapDetails: value?.mapDetails === "slide" ? "slide" : "popup",
});
/** Whether a slide shows the map (the player, cards and PDF agree on this). */
export const slideHasMap = hasMap;
export function timelineIndices(slides, index, fields = []) {
  const slide = slides[index], selected = slide?.generatedBy;
  const filter = slide?.dataView?.filter;
  const temporalSeries = selected?.template === 'filter-series' && (selected.temporal === true || fields.some(field => field.name === filter?.field && /date|timestamp/i.test(field.type || '')));
  if (selected?.template !== 'timeline' && !temporalSeries) return [];
  const matches = item => item?.generatedBy?.template === selected.template &&
    (selected.template === 'timeline' || (item.dataView?.layer === slide.dataView?.layer && item.dataView?.filter?.field === filter?.field));
  if (selected.group) return slides.map((item, i) => matches(item) && item.generatedBy.group === selected.group ? i : -1).filter(i => i >= 0);
  // Previously generated sequences have no group: only join their contiguous run.
  let start = index, end = index;
  while (start > 0 && matches(slides[start - 1]) && !slides[start - 1].generatedBy.group) start--;
  while (end + 1 < slides.length && matches(slides[end + 1]) && !slides[end + 1].generatedBy.group) end++;
  return Array.from({length:end-start+1}, (_,i) => start+i);
}

/**
 * `api`: getSlides() -> visible slides, slideHtml(slide, { index, count }),
 * showSlide(slide, options) -> moves the map, getSettings()/saveSettings()
 * store portable player preferences, mapController, compact() -> phone layout?,
 * title() -> briefing title.
 */
export class BriefingPlayer {
  constructor(api) {
    this.api = api;
    this.state = null;
  }

  get isOpen() {
    return Boolean(this.state);
  }

  open(startId = null) {
    const slides = this.api.getSlides();
    if (!slides.length) return false;
    this.close();
    this.state = {
      slides,
      index: Math.max(0, slides.findIndex((slide) => slide.id === startId)),
      compact: this.api.compact(),
      padding: this.api.mapController.getViewPadding(),
      cleanups: [],
      exploring: false,
      settings: playerSettings(this.api.getSettings?.()),
      originalBasemap: this.api.mapController.getBasemapId?.() || null,
    };
    document.body.classList.add("briefing-presenting", this.state.compact ? "briefing-presenting--cards" : "briefing-presenting--stage");
    if (this.state.compact) this.#openCards();
    else this.#openStage();
    // Hiding the panels changes the map's size; let the layout settle before the first camera move.
    setTimeout(() => {
      if (!this.state) return;
      this.api.mapController.resize();
      void this.#applyBasemap().finally(() => this.#go(this.state.index, { force: true }));
    }, 60);
    return true;
  }

  close() {
    if (!this.state) return;
    this.#stopTimeline();
    void this.api.stopCinematicClip?.();
    const { root, cleanups, padding, originalBasemap, settings } = this.state;
    cleanups.forEach((cleanup) => cleanup());
    root?.remove();
    document.body.classList.remove("briefing-presenting", "briefing-presenting--stage", "briefing-presenting--cards", "briefing-exploring");
    if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {});
    this.api.mapController.setViewPadding(padding);
    // A presentation may use a purpose-built basemap, but exiting returns the
    // authoring map to the basemap it had before the player opened.
    if (settings.basemap && originalBasemap) this.api.mapController.setBasemap?.(originalBasemap);
    this.#writeHash(null);
    this.state = null;
    requestAnimationFrame(() => this.api.mapController.resize());
    this.api.onClose?.();
  }

  /**
   * A compact Map Insight while presenting: { title, subtitle, rows: [[label, value]], note }.
   * Clicks on the map pass through the slide frame, so details stay one click away.
   */
  showInsight(insight) {
    const state = this.state;
    if (!state?.root) return;
    this.hideInsight();
    const card = document.createElement("aside");
    const insideSlide = state.settings.mapDetails === "slide";
    card.className = `briefing-insight${insideSlide ? " briefing-insight--inline" : ""}`;
    card.setAttribute("aria-live", "polite");
    card.setAttribute("aria-label", "Map insight");
    const rows = (insight.rows || []).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("");
    card.innerHTML = `<header><span><small>Map insight</small><strong>${escapeHtml(insight.title || "Location")}</strong>${insight.subtitle ? `<span>${escapeHtml(insight.subtitle)}</span>` : ""}</span><button type="button" data-insight-close aria-label="Close map insight" title="Close (Esc)">×</button></header>${rows ? `<dl>${rows}</dl>` : ""}${insight.note ? `<p>${escapeHtml(insight.note)}</p>` : ""}`;
    card.querySelector("[data-insight-close]").addEventListener("click", () => this.hideInsight());
    const slide = insideSlide ? this.#currentSlideElement() : null;
    (slide || state.root).append(card);
    if (insideSlide && state.compact) {
      const briefingCard = slide?.closest(".briefing-card");
      briefingCard?.classList.add("is-expanded");
      const more = briefingCard?.querySelector("[data-card-more]");
      if (more) { more.hidden = false; more.textContent = "Less"; }
      this.#applyPadding();
    }
  }

  hideInsight() {
    this.state?.root?.querySelectorAll(".briefing-insight").forEach((element) => element.remove());
  }

  #currentSlideElement() {
    const state = this.state;
    if (!state?.root) return null;
    return state.compact
      ? state.root.querySelector(`[data-card="${state.index}"] .briefing-slide`)
      : state.root.querySelector(".briefing-stage__panel .briefing-slide");
  }

  #settingsMarkup() {
    const settings = this.state.settings;
    const basemaps = this.api.mapController.getBasemapOptions?.().options || [];
    const options = basemaps.map((item) => `<option value="${escapeHtml(item.id)}"${settings.basemap === item.id ? " selected" : ""}>${escapeHtml(item.label || item.id)}</option>`).join("");
    return `<header><span><small>Briefing player</small><strong>Settings</strong></span><button type="button" data-stage-settings-close aria-label="Close briefing settings">×</button></header>
      <label><span>Basemap</span><select data-player-setting="basemap"><option value=""${settings.basemap ? "" : " selected"}>Use project basemap</option>${options}</select></label>
      <label class="briefing-player-settings__check"><input type="checkbox" data-player-setting="animations"${settings.animations ? " checked" : ""}> Animate changes between slides</label>
      <label><span>Camera movement</span><select data-player-setting="motion"${settings.animations ? "" : " disabled"}><option value="pan"${settings.motion === "pan" ? " selected" : ""}>Pan to each slide</option><option value="fly"${settings.motion === "fly" ? " selected" : ""}>Fly to each slide</option></select></label>
      <label><span>Map click details</span><select data-player-setting="mapDetails"><option value="popup"${settings.mapDetails === "popup" ? " selected" : ""}>Floating Map Insight</option><option value="slide"${settings.mapDetails === "slide" ? " selected" : ""}>Inside the current slide</option></select><small>Applies to both Intelligence location clicks and Map Insights.</small></label>`;
  }

  #toggleSettings(force) {
    const panel = this.state?.root?.querySelector(".briefing-player-settings");
    if (!panel) return;
    panel.hidden = force === undefined ? !panel.hidden : !force;
    this.state.root.querySelector('[data-stage="settings"], [data-cards-settings]')?.setAttribute("aria-pressed", String(!panel.hidden));
  }

  #syncSettings() {
    const state = this.state;
    if (!state?.root) return;
    const panel = state.root.querySelector(".briefing-player-settings");
    if (!panel) return;
    panel.querySelector('[data-player-setting="animations"]')?.toggleAttribute("checked", state.settings.animations);
    const motion = panel.querySelector('[data-player-setting="motion"]');
    if (motion) motion.disabled = !state.settings.animations;
  }

  async #applyBasemap() {
    const state = this.state;
    if (!state) return;
    const wanted = state.settings.basemap || state.originalBasemap;
    if (wanted && this.api.mapController.getBasemapId?.() !== wanted) {
      await Promise.resolve(this.api.mapController.setBasemap?.(wanted));
      await Promise.resolve(this.api.mapController.whenBasemapLoaded?.()).catch(() => {});
    }
  }

  #saveSettings(patch) {
    const state = this.state;
    if (!state) return;
    state.settings = playerSettings({ ...state.settings, ...patch });
    this.api.saveSettings?.(state.settings);
    this.#syncSettings();
  }

  #listen(target, type, handler, options) {
    target.addEventListener(type, handler, options);
    this.state.cleanups.push(() => target.removeEventListener(type, handler, options));
  }

  // Deep links address a slide by its ID (#slide=s-7f3a); other fragment values are kept.
  #writeHash(slideId) {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    if (slideId) params.set("slide", slideId);
    else params.delete("slide");
    const hash = params.toString();
    history.replaceState(null, "", `${location.pathname}${location.search}${hash ? `#${hash}` : ""}`);
  }

  async #go(index, { force = false } = {}) {
    const state = this.state;
    if (!state) return;
    const next = Math.min(state.slides.length - 1, Math.max(0, index));
    if (next === state.index && !force) return;
    if (next !== state.index || force) state.timelineFrame = 0;
    if (next !== state.index) this.hideInsight();
    state.index = next;
    const slide = state.slides[next];
    // A rare presentation-only effect can request a different renderer for
    // this one slide. The host hands the renderer off in place, then this same
    // player continues rendering and moving the requested slide.
    if (await this.api.ensureSlideEngine?.(slide)) return;
    this.#writeHash(slide.id);
    if (state.compact) this.#syncCards();
    else this.#renderStage();
    this.#syncTimeline();
    this.#applyPadding();
    await this.api.showSlide(slide, { animate: state.settings.animations, motion: state.settings.motion });
    if (slide.template === "cinematic") await this.api.playCinematicClip?.(slide, { autoplay: slide.autoplay === true });
    else await this.api.stopCinematicClip?.();
  }

  /** Re-centres the camera within the part of the map that is visible for this slide. */
  #applyPadding() {
    const state = this.state;
    const { mapController } = this.api;
    if (!state || !mapController.isReady()) return;
    if (state.compact) {
      const body = state.root.querySelectorAll(".briefing-card")[state.index]?.querySelector(".briefing-card__body");
      mapController.setViewPadding(state.exploring || !body ? { top: 0, right: 0, bottom: 0, left: 0 } : { top: 0, right: 0, bottom: Math.round(body.getBoundingClientRect().height), left: 0 });
      return;
    }
    // Looking at a slide's place: the frame is hidden and the whole map is the view.
    if (state.exploring) { mapController.setViewPadding({ top: 0, right: 0, bottom: 0, left: 0 }); return; }
    const mapWindow = state.root.querySelector(".briefing-stage__window");
    const frame = state.root.querySelector(".briefing-stage__frame");
    const area = (mapWindow && !mapWindow.hidden ? mapWindow : frame)?.getBoundingClientRect();
    const container = mapController.getContainer()?.getBoundingClientRect?.();
    if (!area || !container) return;
    mapController.setViewPadding({
      top: Math.max(0, Math.round(area.top - container.top)),
      left: Math.max(0, Math.round(area.left - container.left)),
      right: Math.max(0, Math.round(container.right - area.right)),
      bottom: Math.max(0, Math.round(container.bottom - area.bottom)),
    });
  }

  /* ---------------- Desktop stage ---------------- */

  #openStage() {
    const root = document.createElement("section");
    root.className = "briefing-stage";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", `${this.api.title()} slides`);
    root.innerHTML = `<div class="briefing-stage__frame"><div class="briefing-stage__panel" aria-live="polite"></div><div class="briefing-stage__window" aria-hidden="true"></div></div>
      <div class="briefing-stage__thumbs" hidden></div>
      <button type="button" class="briefing-stage__back" data-stage-back hidden>← Back to the slide</button>
      <aside class="briefing-stage__notes" hidden><header><strong>Presenter notes</strong><button type="button" data-stage-notes-close aria-label="Close notes">×</button></header><div data-stage-notes-body></div></aside>
      <aside class="briefing-player-settings" hidden>${this.#settingsMarkup()}</aside>
      <nav class="briefing-stage__controls" aria-label="Briefing controls">
        <button type="button" data-stage="thumbs" aria-pressed="false" title="Slides (T)">▦</button>
        <button type="button" data-stage="previous" aria-label="Previous slide" title="Previous (←)">←</button>
        <span class="briefing-stage__count" data-stage-count></span>
        <button type="button" data-stage="next" aria-label="Next slide" title="Next (→)">→</button>
        <button type="button" data-stage="notes" aria-pressed="false" title="Presenter notes (N)">Notes</button>
        <button type="button" data-stage="settings" aria-pressed="false" title="Briefing settings">Settings</button>
        <button type="button" data-stage="reset" title="Reset slide: return its map to the saved view">Reset</button>
        <button type="button" data-stage="restart" title="Back to the first slide (Home)">Restart</button>
        <button type="button" data-stage="fullscreen" title="Fullscreen (F)">⛶</button>
        <button type="button" data-stage="exit" class="briefing-stage__exit" title="Exit (Esc)">Exit</button>
      </nav>${this.#timelineControls()}`;
    document.body.append(root);
    this.state.root = root;
    this.#bindTimeline(root);
    const actions = {
      previous: () => this.#go(this.state.index - 1),
      next: () => this.#go(this.state.index + 1),
      restart: () => this.#go(0),
      reset: () => this.#resetSlide(),
      thumbs: () => this.#toggle("thumbs"),
      notes: () => this.#toggle("notes"),
      settings: () => this.#toggleSettings(),
      fullscreen: () => this.#toggleFullscreen(),
      exit: () => this.close(),
    };
    root.querySelectorAll("[data-stage]").forEach((button) => button.addEventListener("click", () => actions[button.dataset.stage]?.()));
    root.querySelector("[data-stage-notes-close]").addEventListener("click", () => this.#toggle("notes", false));
    root.querySelector("[data-stage-settings-close]").addEventListener("click", () => this.#toggleSettings(false));
    root.querySelector(".briefing-player-settings").addEventListener("change", (event) => {
      const input = event.target.closest("[data-player-setting]");
      if (!input) return;
      const key = input.dataset.playerSetting;
      const value = input.type === "checkbox" ? input.checked : input.value;
      this.#saveSettings({ [key]: key === "basemap" ? value || null : value });
      if (key === "basemap") void this.#applyBasemap();
    });
    root.querySelector("[data-stage-back]").addEventListener("click", () => this.#explore(false));
    this.#bindSlideContent(root);
    // Only the controls and keys change slides; clicks and drags on the map stay with the map.
    this.#listen(document, "keydown", (event) => {
      if (event.target.closest?.("input, textarea, select, [contenteditable]")) return;
      const key = event.key;
      // Arrow keys in a focused slideshow move its images, not the slides.
      if (event.target.closest?.("[data-gallery-track]") && ["ArrowLeft", "ArrowRight"].includes(key)) return;
      if (key === "Escape" && this.state?.exploring) { event.preventDefault(); this.#explore(false); return; }
      if (["ArrowRight", "PageDown", " "].includes(key)) { event.preventDefault(); actions.next(); }
      else if (["ArrowLeft", "PageUp"].includes(key)) { event.preventDefault(); actions.previous(); }
      else if (key === "Home") actions.restart();
      else if (key === "End") this.#go(this.state.slides.length - 1);
      else if (key === "Escape" && this.state.root.querySelector(".briefing-insight")) this.hideInsight();
      else if (key === "Escape" && !this.state.root.querySelector(".briefing-player-settings")?.hidden) this.#toggleSettings(false);
      else if (key === "Escape" && !document.fullscreenElement) actions.exit();
      else if (key.toLowerCase() === "f") actions.fullscreen();
      else if (key.toLowerCase() === "t") actions.thumbs();
      else if (key.toLowerCase() === "n") actions.notes();
    });
    const relayout = () => requestAnimationFrame(() => { this.api.mapController.resize(); this.#applyPadding(); });
    this.#listen(window, "resize", relayout);
    this.#listen(document, "fullscreenchange", relayout);
    this.#listen(window, "hashchange", () => {
      const id = new URLSearchParams(location.hash.replace(/^#/, "")).get("slide");
      const index = this.state?.slides.findIndex((slide) => slide.id === id) ?? -1;
      if (index >= 0) this.#go(index);
    });
  }

  #timelineControls() {
    return `<div class="briefing-timeline-playback" data-timeline-controls hidden aria-label="Timeline playback">
      <button type="button" data-timeline-play aria-pressed="false">Play</button>
      <label>Frame <input type="range" data-timeline-scrub min="0" max="0" value="0" aria-label="Timeline frame"></label>
      <span data-timeline-frame></span>
      <label>Speed <select data-timeline-speed aria-label="Timeline playback speed"><option value="2500">Slow</option><option value="1200" selected>Normal</option><option value="500">Fast</option></select></label>
      <label>Direction <select data-timeline-direction aria-label="Timeline playback direction"><option value="1">Forward</option><option value="-1">Reverse</option></select></label>
      <label><input type="checkbox" data-timeline-loop> Loop</label>
    </div>`;
  }

  #stopTimeline() {
    if (!this.state) return;
    clearTimeout(this.state.timelineTimer);
    this.state.timelineTimer = null;
    this.state.timelinePlaying = false;
    this.state.timelineEpoch = (this.state.timelineEpoch || 0) + 1;
    this.#syncTimeline();
  }

  #syncTimeline() {
    const state = this.state;
    const controls = state?.root?.querySelector('[data-timeline-controls]');
    if (!controls) return;
    const indices = timelineIndices(state.slides, state.index, this.api.fields?.() || []);
    const frames = state.slides[state.index]?.timeline?.frames;
    const single = Array.isArray(frames) && frames.length > 0;
    controls.hidden = !indices.length;
    if (!indices.length) {
      clearTimeout(state.timelineTimer);
      state.timelineTimer = null;
      state.timelinePlaying = false;
      state.timelineEpoch = (state.timelineEpoch || 0) + 1;
      return;
    }
    const current = single ? Math.min(state.timelineFrame || 0, frames.length - 1) : indices.indexOf(state.index);
    const length = single ? frames.length : indices.length;
    const slider = controls.querySelector('[data-timeline-scrub]');
    slider.max = String(length - 1);
    slider.value = String(current);
    controls.querySelector('[data-timeline-frame]').textContent = `${current + 1} / ${length} · ${single ? frames[current].title : (this.api.slideTitle?.(state.slides[state.index]) || state.slides[state.index].title || "")}`;
    const button = controls.querySelector('[data-timeline-play]');
    button.textContent = state.timelinePlaying ? 'Pause' : 'Play';
    button.setAttribute('aria-pressed', String(Boolean(state.timelinePlaying)));
    button.disabled = length < 2;
  }

  #bindTimeline(root) {
    const controls = root.querySelector('[data-timeline-controls]');
    const go = async index => {
      if (this.state?.compact) this.state.root.querySelector(`[data-card="${index}"]`)?.scrollIntoView({block:'start'});
      await this.#go(index);
    };
    const goFrame = async frame => {
      const state = this.state;
      const slide = state?.slides[state.index];
      const item = slide?.timeline?.frames?.[frame];
      if (!item || !slide.dataView) return;
      state.timelineFrame = frame;
      this.#syncTimeline();
      const frameSlide = {...slide, frameNarrative:item.narrative || "", dataView:{...slide.dataView, filter:item.filter}};
      if (state.compact) {
        const content = state.root.querySelector(`[data-card="${state.index}"] .briefing-card__content`);
        if (content) content.innerHTML = this.api.slideHtml(frameSlide, {index:state.index, count:state.slides.length});
      } else state.root.querySelector('.briefing-stage__panel').innerHTML = this.api.slideHtml(frameSlide, {index:state.index, count:state.slides.length});
      await this.api.showSlide(frameSlide);
    };
    const delay = () => {
      const state = this.state, slide = state?.slides[state.index];
      const value = slide?.timeline?.frames?.[state.timelineFrame || 0]?.dwellMs ?? slide?.generatedBy?.dwellMs;
      return Number.isInteger(value) && value >= 250 && value <= 60000 ? value : Number(controls.querySelector('[data-timeline-speed]').value);
    };
    const tick = async epoch => {
      const state = this.state;
      if (!state?.timelinePlaying || state.timelineEpoch !== epoch) return;
      const indices = timelineIndices(state.slides, state.index, this.api.fields?.() || []);
      const direction = Number(controls.querySelector('[data-timeline-direction]').value);
      const frames = state.slides[state.index]?.timeline?.frames;
      const single = Array.isArray(frames) && frames.length > 0;
      const length = single ? frames.length : indices.length;
      let next = (single ? state.timelineFrame || 0 : indices.indexOf(state.index)) + direction;
      if (next < 0 || next >= length) {
        if (!controls.querySelector('[data-timeline-loop]').checked) { this.#stopTimeline(); return; }
        next = next < 0 ? length - 1 : 0;
      }
      if (single) await goFrame(next); else await go(indices[next]);
      if (this.state === state && state.timelinePlaying && state.timelineEpoch === epoch) state.timelineTimer = setTimeout(() => tick(epoch), delay());
    };
    controls.querySelector('[data-timeline-play]').addEventListener('click', () => {
      if (this.state.timelinePlaying) return this.#stopTimeline();
      this.state.timelinePlaying = true;
      const epoch = this.state.timelineEpoch = (this.state.timelineEpoch || 0) + 1;
      this.#syncTimeline();
      this.state.timelineTimer = setTimeout(() => tick(epoch), delay());
    });
    controls.querySelector('[data-timeline-scrub]').addEventListener('input', event => {
      this.#stopTimeline();
      const indices = timelineIndices(this.state.slides, this.state.index, this.api.fields?.() || []);
      const frames = this.state.slides[this.state.index]?.timeline?.frames;
      if (Array.isArray(frames) && frames.length) void goFrame(Number(event.target.value));
      else void go(indices[Number(event.target.value)]);
    });
  }

  #toggle(part, force) {
    const element = this.state.root.querySelector(part === "thumbs" ? ".briefing-stage__thumbs" : ".briefing-stage__notes");
    element.hidden = force === undefined ? !element.hidden : !force;
    this.state.root.querySelector(`[data-stage="${part}"]`)?.setAttribute("aria-pressed", String(!element.hidden));
    if (part === "thumbs" && !element.hidden) element.querySelector(".is-current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  #toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  }

  async #resetSlide() {
    const state = this.state;
    if (!state) return;
    this.hideInsight();
    this.#stopTimeline();
    state.timelineFrame = 0;
    if (state.compact) {
      const content = state.root.querySelector(`[data-card="${state.index}"] .briefing-card__content`);
      if (content) content.innerHTML = this.api.slideHtml(state.slides[state.index], { index: state.index, count: state.slides.length });
      this.#syncCards();
    } else this.#renderStage();
    this.#syncTimeline();
    this.#applyPadding();
    await this.api.showSlide(state.slides[state.index], { animate: false, motion: "pan", reset: true });
    if (state.slides[state.index].template === "cinematic") await this.api.playCinematicClip?.(state.slides[state.index], { autoplay: state.slides[state.index].autoplay === true });
  }

  #renderStage() {
    const { root, slides, index } = this.state;
    const slide = slides[index];
    const withMap = hasMap(slide);
    root.querySelector(".briefing-stage__frame").classList.toggle("is-full", !withMap);
    root.querySelector(".briefing-stage__window").hidden = !withMap;
    root.querySelector(".briefing-stage__panel").innerHTML = this.api.slideHtml(slide, { index, count: slides.length });
    root.querySelector("[data-stage-count]").textContent = `${index + 1} / ${slides.length}`;
    root.querySelector('[data-stage="previous"]').disabled = index === 0;
    root.querySelector('[data-stage="next"]').disabled = index === slides.length - 1;
    root.querySelector("[data-stage-notes-body]").innerHTML = slide.notes ? escapeHtml(slide.notes).replaceAll("\n", "<br>") : "<p class=\"form-note\">No notes for this slide.</p>";
    const thumbs = root.querySelector(".briefing-stage__thumbs");
    thumbs.innerHTML = slides.map((item, position) => `<button type="button" class="briefing-thumb${position === index ? " is-current" : ""}" data-thumb="${position}" aria-current="${position === index}"><span>${position + 1}</span><strong>${escapeHtml(this.api.slideTitle?.(item) || item.title || "Untitled slide")}</strong></button>`).join("");
    thumbs.querySelectorAll("[data-thumb]").forEach((button) => button.addEventListener("click", () => this.#go(Number(button.dataset.thumb))));
    if (!thumbs.hidden) thumbs.querySelector(".is-current")?.scrollIntoView({ block: "nearest", inline: "center" });
  }

  /* ---------------- Phone cards ---------------- */

  #openCards() {
    const { slides } = this.state;
    const root = document.createElement("section");
    root.className = "briefing-cards";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", `${this.api.title()} slides`);
    root.innerHTML = `<div class="briefing-cards__deck">${slides.map((slide, index) => `<article class="briefing-card${hasMap(slide) ? "" : " is-full"}" data-card="${index}">
        ${hasMap(slide) ? `<button type="button" class="briefing-card__map" data-card-explore aria-label="Explore the map for this slide"><span>Tap the map to explore</span></button>` : ""}
        <div class="briefing-card__body"><div class="briefing-card__content">${this.api.slideHtml(slide, { index, count: slides.length })}</div><button type="button" class="briefing-card__more" data-card-more hidden>More</button></div>
      </article>`).join("")}</div>
      <header class="briefing-cards__top"><span class="briefing-cards__progress" data-cards-progress></span><span class="briefing-cards__actions"><button type="button" data-cards-settings aria-label="Briefing settings" title="Briefing settings">⚙</button><button type="button" data-cards-exit aria-label="Close slides">×</button></span></header>
      <aside class="briefing-player-settings" hidden>${this.#settingsMarkup()}</aside>
      <div class="briefing-cards__hint" data-cards-hint>Swipe up for the next slide</div>
      <button type="button" class="briefing-cards__done" data-cards-done hidden>Done exploring</button>${this.#timelineControls()}`;
    document.body.append(root);
    this.state.root = root;
    this.#bindTimeline(root);
    const deck = root.querySelector(".briefing-cards__deck");
    root.querySelector("[data-cards-exit]").addEventListener("click", () => this.close());
    root.querySelector("[data-cards-settings]").addEventListener("click", () => this.#toggleSettings());
    root.querySelector("[data-stage-settings-close]").addEventListener("click", () => this.#toggleSettings(false));
    root.querySelector(".briefing-player-settings").addEventListener("change", (event) => {
      const input = event.target.closest("[data-player-setting]");
      if (!input) return;
      const key = input.dataset.playerSetting;
      const value = input.type === "checkbox" ? input.checked : input.value;
      this.#saveSettings({ [key]: key === "basemap" ? value || null : value });
      if (key === "basemap") void this.#applyBasemap();
    });
    root.querySelectorAll("[data-card-explore]").forEach((button) => button.addEventListener("click", () => this.#explore(true)));
    root.querySelector("[data-cards-done]").addEventListener("click", () => this.#explore(false));
    this.#bindSlideContent(root);
    // Long text folds behind "More"; the card expands in place.
    root.querySelectorAll(".briefing-card").forEach((card) => {
      const content = card.querySelector(".briefing-card__content");
      const more = card.querySelector("[data-card-more]");
      setTimeout(() => { more.hidden = content.scrollHeight <= content.clientHeight + 4; }, 60);
      more.addEventListener("click", () => {
        const expanded = card.classList.toggle("is-expanded");
        more.textContent = expanded ? "Less" : "More";
        if (card.dataset.card === String(this.state.index)) this.#applyPadding();
      });
    });
    // The card most in view is the current slide; the map follows once a swipe settles.
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting && entry.intersectionRatio >= 0.6).map((entry) => Number(entry.target.dataset.card));
      if (visible.length && this.state && !this.state.exploring) void this.#go(visible[0]);
    }, { root: deck, threshold: [0.6] });
    root.querySelectorAll(".briefing-card").forEach((card) => observer.observe(card));
    this.state.cleanups.push(() => observer.disconnect());
    this.#listen(deck, "scroll", () => { root.querySelector("[data-cards-hint]")?.remove(); }, { once: true });
    setTimeout(() => this.state && deck.querySelector(`[data-card="${this.state.index}"]`)?.scrollIntoView({ block: "start" }), 0);
  }

  #syncCards() {
    const { root, slides, index } = this.state;
    root.querySelector("[data-cards-progress]").textContent = `${index + 1} of ${slides.length}`;
    root.querySelectorAll(".briefing-card").forEach((card) => card.classList.toggle("is-current", card.dataset.card === String(index)));
  }

  /**
   * Slide content is redrawn as slides change, so its controls are delegated: a
   * slideshow's arrows and dots, and a media slide's "Show on the map".
   */
  #bindSlideContent(root) {
    const sync = (track) => {
      const gallery = track.closest("[data-gallery]");
      const current = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
      gallery?.querySelectorAll("[data-gallery-dot]").forEach((dot) => dot.toggleAttribute("aria-current", Number(dot.dataset.galleryDot) === current));
    };
    root.addEventListener("click", (event) => {
      const step = event.target.closest("[data-gallery-step], [data-gallery-dot]");
      if (step) {
        const track = step.closest("[data-gallery]")?.querySelector("[data-gallery-track]");
        if (!track) return;
        const current = Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
        const count = track.children.length;
        const target = step.dataset.galleryDot != null ? Number(step.dataset.galleryDot) : (current + Number(step.dataset.galleryStep) + count) % count;
        track.scrollTo({ left: target * track.clientWidth, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        return;
      }
      const place = event.target.closest("[data-slide-place]");
      if (place) {
        const slide = this.state?.slides.find((item) => item.id === place.dataset.slidePlace);
        if (!slide?.camera) return;
        this.#explore(true);
        void this.api.showSlide(slide);
        return;
      }
      const play = event.target.closest("[data-cinematic-slide-play]");
      if (play) {
        // Loading a remote Feature Service can take a moment.  Keep the
        // control honest while it happens and surface an actionable failure
        // instead of leaving a click that appears to do nothing.
        const label = play.textContent;
        play.disabled = true;
        play.textContent = "Loading clip…";
        void Promise.resolve(this.api.playCinematicClip?.(this.state?.slides[this.state.index], { autoplay: true }))
          .catch((error) => this.api.notify?.(`Could not play this clip: ${error?.message || "unknown error"}`))
          .finally(() => {
            if (!play.isConnected) return;
            play.disabled = false;
            play.textContent = label;
          });
        return;
      }
      if (event.target.closest("[data-cinematic-slide-pause]")) this.api.pauseCinematicClip?.();
    });
    // Scroll events do not bubble; capture them to keep the dots in step with swipes.
    root.addEventListener("scroll", (event) => { if (event.target.matches?.("[data-gallery-track]")) sync(event.target); }, true);
  }

  /** Exploring hands every gesture to the map until Done returns to the cards. */
  #explore(on) {
    const state = this.state;
    if (!state) return;
    state.exploring = on;
    document.body.classList.toggle("briefing-exploring", on);
    const back = state.root.querySelector("[data-cards-done], [data-stage-back]");
    if (back) back.hidden = !on;
    if (on) back?.focus?.();
    this.#applyPadding();
    if (!on) {
      this.hideInsight();
      state.root.querySelector(`[data-card="${state.index}"]`)?.scrollIntoView({ block: "start" });
      void this.api.showSlide(state.slides[state.index]);
    }
  }
}
