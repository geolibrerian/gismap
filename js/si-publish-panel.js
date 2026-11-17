// The Publish panel for a map saved in GISMap SI. It shows what a share link would
// give viewers (audience, live or pinned, layers, pinned figures), publishes only when
// the user presses Publish, and shows SI's verification report. The assistant can open
// this panel (si_publish_preview) but nothing it does publishes.
//
// publishPanelModel() and renderPublishPanel() are pure, for tests; SiPublishPanel wires
// them to SI through the open SiMapSession.

import { describeSiError } from "./si-maps.js?v=0.72.0-si-maps";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const trimUrl = (url) => String(url || "").replace(/\/+$/, "");

export const DATA_MODES = Object.freeze([
  { id: "live", label: "Live", description: "Figures recompute when the Brief plays. You can republish later edits to the same link." },
  { id: "pinned", label: "Pinned", description: "Figures are frozen as they are now and shown “as of” today. The link always shows this version." },
]);
const VERIFICATION_LABELS = { passed: "Verified", warning: "Verified with warnings", failed: "Verification failed" };
const CHECK_LABELS = { passed: "Passed", warning: "Warning", failed: "Failed", not_checked: "Not checked" };

/** The Brief with each `stat` block's current figure pinned (`figures` from BriefingSlides.figures()). */
export function pinFigures(briefing, figures = [], computedAt = new Date().toISOString()) {
  if (!briefing?.slides) return briefing;
  const values = new Map(figures.map((figure) => [`${figure.slideId}/${figure.blockId}`, figure.value]));
  return {
    ...briefing,
    slides: briefing.slides.map((slide) => ({
      ...slide,
      blocks: (slide.blocks || []).map((block) => {
        if (block?.type !== "stat" || !values.has(`${slide.id}/${block.id}`)) return block;
        const value = values.get(`${slide.id}/${block.id}`);
        return { ...block, pinned: { value: Number.isFinite(value) ? value : null, computedAt } };
      }),
    })),
  };
}

/** The Brief with no pinned figures: a live publication recomputes them. */
export function unpinFigures(briefing) {
  if (!briefing?.slides) return briefing;
  return {
    ...briefing,
    slides: briefing.slides.map((slide) => ({
      ...slide,
      blocks: (slide.blocks || []).map((block) => {
        if (block?.type !== "stat" || !("pinned" in block)) return block;
        const { pinned: _pinned, ...rest } = block;
        return rest;
      }),
    })),
  };
}

/**
 * What the panel shows. `state` is one of: signed-out, read-only, empty, ready,
 * publishing, published, error. Inputs: `connected`, `canEdit`, `unsaved`, `dataMode`,
 * `layers` (map-v1 layers), `datasets` (from /context), `figures`, `publication`
 * (SI's publication response, with `verification`), `busy`, `error`, `warnings`.
 */
export function publishPanelModel({
  connected = false, canEdit = false, unsaved = false, dataMode = "live", layers = [], datasets = [],
  figures = [], publication = null, busy = false, error = null, warnings = [],
} = {}) {
  const mode = DATA_MODES.some((item) => item.id === dataMode) ? dataMode : "live";
  const byUrl = new Map(datasets.filter((dataset) => dataset?.featureServerUrl).map((dataset) => [trimUrl(dataset.featureServerUrl), dataset]));
  const rows = layers.map((layer) => {
    const dataset = byUrl.get(trimUrl(layer.url));
    return {
      title: layer.title || layer.url,
      source: dataset ? `GISMap SI dataset${dataset.title ? `: ${dataset.title}` : ""}` : "External source",
      lastChange: dataset?.freshness?.last_changed_at || dataset?.updatedAt || null,
      data: mode === "pinned" ? "Pinned: the data its link serves now" : "Live figures; the data its link serves",
    };
  });
  const verification = publication?.verification ? {
    status: publication.verification.status,
    label: VERIFICATION_LABELS[publication.verification.status] || "Verification",
    ranAt: publication.verification.ranAt || null,
    checks: (publication.verification.checks || []).map((check) => ({
      id: String(check?.id || ""),
      status: String(check?.status || "not_checked"),
      statusLabel: CHECK_LABELS[check?.status] || String(check?.status || ""),
      // SI's messages are written for people: shown as written.
      message: String(check?.message ?? ""),
      layerId: check?.layerId || null,
    })),
  } : null;
  let state = "ready";
  if (!connected) state = "signed-out";
  else if (!canEdit) state = "read-only";
  else if (busy) state = "publishing";
  else if (error) state = "error";
  else if (publication && !publication.revokedAt) state = "published";
  else if (!layers.length) state = "empty";
  const notes = [];
  if (unsaved && canEdit) notes.push("Your unsaved changes are saved to GISMap SI first.");
  if (mode === "live") notes.push("Until GISMap SI can follow new data, a live publication's layers keep the data their links serve now; only its figures recompute.");
  if (rows.some((row) => row.source === "External source")) notes.push("GISMap SI reports external layers in the verification but doesn't test them.");
  const livePublication = publication && !publication.revokedAt && publication.dataMode === "live";
  return {
    state,
    audience: "Anyone with the link",
    audienceNote: "The draft stays visible only to your workspace. Viewers see the version you publish, not later edits.",
    dataMode: mode,
    modes: DATA_MODES.map((item) => ({ ...item, selected: item.id === mode })),
    layers: rows,
    figures: figures.map((figure) => ({ ...figure, pinned: mode === "pinned" })),
    notes,
    warnings: warnings.map(String),
    error: error ? { message: error.message || String(error), issues: error.issues || [] } : null,
    publication: publication ? {
      id: publication.id,
      shareUrl: publication.shareUrl,
      dataMode: publication.dataMode,
      mapVersion: publication.mapVersion,
      publishedAt: publication.updatedAt || publication.createdAt || null,
      revoked: Boolean(publication.revokedAt),
    } : null,
    verification,
    actions: {
      signIn: state === "signed-out",
      publish: ["ready", "published", "error"].includes(state) && layers.length > 0,
      republish: state === "published" && Boolean(livePublication),
      verify: state === "published",
    },
  };
}

const formatValue = (value) => (value == null ? "—" : Number(value).toLocaleString(undefined, { maximumFractionDigits: Math.abs(value) < 10 ? 2 : 0 }));

/** The panel's HTML for a model from publishPanelModel(). Every SI string is escaped. */
export function renderPublishPanel(model) {
  if (model.state === "signed-out") {
    return `<section class="si-publish" data-state="signed-out"><h2>Publish</h2><p>Publishing needs your GISMap SI connection.</p><button type="button" class="button--primary" data-si-action="sign-in">Sign in to GISMap SI</button></section>`;
  }
  if (model.state === "read-only") {
    return `<section class="si-publish" data-state="read-only"><h2>Publish</h2><p>You can view this map but not publish it. Ask an editor of its GISMap SI workspace.</p></section>`;
  }
  const modes = model.modes.map((mode) => `<label class="si-publish__mode"><input type="radio" name="si-data-mode" value="${mode.id}"${mode.selected ? " checked" : ""}${model.state === "publishing" ? " disabled" : ""}> <strong>${escapeHtml(mode.label)}</strong> <small>${escapeHtml(mode.description)}</small></label>`).join("");
  const layers = model.layers.length
    ? `<ul class="si-publish__layers">${model.layers.map((layer) => `<li><strong>${escapeHtml(layer.title)}</strong><small>${escapeHtml(layer.source)}${layer.lastChange ? ` · changed ${escapeHtml(String(layer.lastChange).slice(0, 10))}` : ""} · ${escapeHtml(layer.data)}</small></li>`).join("")}</ul>`
    : `<p>Add a layer before publishing.</p>`;
  const figures = model.figures.length
    ? `<ul class="si-publish__figures">${model.figures.map((figure) => `<li><span>${escapeHtml(figure.label)}${figure.slide ? ` <small>(${escapeHtml(figure.slide)})</small>` : ""}</span><strong>${escapeHtml(formatValue(figure.value))}</strong>${figure.pinned ? "<small>pinned</small>" : "<small>recomputes</small>"}${figure.sample ? "<small>sample of loaded features</small>" : ""}</li>`).join("")}</ul>`
    : `<p class="si-publish__muted">This map has no figures to pin.</p>`;
  const notes = model.notes.map((note) => `<p class="si-publish__note">${escapeHtml(note)}</p>`).join("");
  const warnings = model.warnings.length ? `<ul class="si-publish__warnings" role="status">${model.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : "";
  const error = model.error ? `<div class="si-publish__error" role="alert"><p>${escapeHtml(model.error.message)}</p>${model.error.issues.length ? `<ul>${model.error.issues.map((issue) => `<li>${escapeHtml(issue.message)}${issue.layerId ? ` <small>(layer ${escapeHtml(issue.layerId)})</small>` : ""}</li>`).join("")}</ul>` : ""}</div>` : "";
  const publication = model.publication && !model.publication.revoked ? `<div class="si-publish__link"><span>Share link (${escapeHtml(model.publication.dataMode)}, version ${escapeHtml(model.publication.mapVersion)})</span><input type="text" readonly value="${escapeHtml(model.publication.shareUrl)}" aria-label="Share link"><button type="button" data-si-action="copy-link">Copy link</button></div>` : "";
  const verification = model.verification ? `<div class="si-publish__verification" data-status="${escapeHtml(model.verification.status)}"><h3>${escapeHtml(model.verification.label)}</h3><ul>${model.verification.checks.map((check) => `<li data-status="${escapeHtml(check.status)}"><span class="si-publish__check">${escapeHtml(check.statusLabel)}</span> ${escapeHtml(check.message)}${check.layerId ? ` <small>(layer ${escapeHtml(check.layerId)})</small>` : ""}</li>`).join("")}</ul></div>` : "";
  const busy = model.state === "publishing";
  const buttons = [
    model.actions.publish ? `<button type="button" class="button--primary" data-si-action="publish"${busy ? " disabled" : ""}>${model.publication && !model.publication.revoked ? "Publish a new link" : "Publish"}</button>` : "",
    model.actions.republish ? `<button type="button" data-si-action="republish"${busy ? " disabled" : ""}>Republish to this link</button>` : "",
    model.actions.verify ? `<button type="button" data-si-action="verify"${busy ? " disabled" : ""}>Verify again</button>` : "",
  ].join("");
  return `<section class="si-publish" data-state="${escapeHtml(model.state)}" aria-busy="${busy}">
    <h2>Publish</h2>
    <div class="si-publish__group"><h3>Who can open the link</h3><p><strong>${escapeHtml(model.audience)}</strong></p><p class="si-publish__muted">${escapeHtml(model.audienceNote)}</p></div>
    <fieldset class="si-publish__group"><legend>Data</legend>${modes}</fieldset>
    <div class="si-publish__group"><h3>Layers</h3>${layers}</div>
    <div class="si-publish__group"><h3>${model.dataMode === "pinned" ? "Pinned figures" : "Figures"}</h3>${figures}</div>
    ${notes}${warnings}${error}${publication}${verification}
    <div class="si-publish__actions">${buttons}${busy ? `<span role="status">Publishing and verifying…</span>` : ""}</div>
  </section>`;
}

/**
 * The panel in the page. `host`: { connection, session (SiMapSession), client (SiMapsClient),
 * currentSpec(), figures(), applyBriefing(briefing), afterSave(result), signIn(), copy(text), context() }.
 */
export class SiPublishPanel {
  constructor(host) {
    this.host = host;
    this.dataMode = "live";
    this.publication = null;
    this.busy = false;
    this.error = null;
    this.warnings = [];
    this.datasets = [];
    this.container = null;
  }

  /** Shows the panel in `container`, reading the map's latest publication first. */
  async open(container) {
    this.container = container;
    this.error = null;
    this.render();
    const { session, client, connection } = this.host;
    if (!connection.connected || !session.canEdit || !session.mapId) return;
    try {
      const [list, context] = await Promise.all([
        session.document?.id ? client.publications(session.mapId) : { publications: [] },
        this.host.context?.().catch(() => null),
      ]);
      this.publication = (list?.publications || []).find((item) => !item.revokedAt) || null;
      if (this.publication?.dataMode) this.dataMode = this.publication.dataMode;
      this.datasets = context?.datasets || [];
    } catch (error) {
      this.error = describeSiError(error);
    }
    this.render();
  }

  model() {
    const { session, connection } = this.host;
    let spec = { layers: [] };
    try { spec = this.host.currentSpec(); } catch { /* Map not ready. */ }
    let figures = [];
    try { figures = spec.briefing?.slides?.length ? this.host.figures() : []; } catch { /* No Brief. */ }
    return publishPanelModel({
      connected: connection.connected,
      canEdit: session.canEdit || (!session.document && connection.can("maps:write")),
      unsaved: session.changed(spec),
      dataMode: this.dataMode,
      layers: spec.layers || [],
      datasets: this.datasets,
      figures,
      publication: this.publication,
      busy: this.busy,
      error: this.error,
      warnings: this.warnings,
    });
  }

  render() {
    if (!this.container) return;
    this.container.innerHTML = renderPublishPanel(this.model());
    this.container.querySelectorAll("input[name=si-data-mode]").forEach((input) => input.addEventListener("change", () => { this.dataMode = input.value; this.render(); }));
    this.container.querySelectorAll("[data-si-action]").forEach((button) => button.addEventListener("click", () => this.#act(button.dataset.siAction)));
  }

  async #act(action) {
    if (action === "sign-in") { await this.host.signIn(); return this.open(this.container); }
    if (action === "copy-link") return this.host.copy?.(this.publication?.shareUrl || "");
    if (action === "publish") return this.publish();
    if (action === "republish") return this.republish();
    if (action === "verify") return this.verify();
  }

  /** Saves what the user sees (pinning or unpinning figures), then publishes that exact version. */
  async publish() { return this.#run(async () => this.host.client.publish(this.host.session.mapId, this.dataMode, await this.#saveForPublishing())); }

  /** Moves a live publication to the current version: the same link. */
  async republish() {
    const publication = this.publication;
    if (!publication) return null;
    return this.#run(async () => this.host.client.republish(this.host.session.mapId, publication.id, await this.#saveForPublishing("live")));
  }

  async verify() {
    const publication = this.publication;
    if (!publication) return null;
    return this.#run(async () => ({ ...publication, verification: await this.host.client.verify(this.host.session.mapId, publication.id) }));
  }

  async #saveForPublishing(dataMode = this.dataMode) {
    const { session } = this.host;
    let spec = this.host.currentSpec();
    if (spec.briefing?.slides?.length) {
      const briefing = dataMode === "pinned" ? pinFigures(spec.briefing, this.host.figures()) : unpinFigures(spec.briefing);
      if (JSON.stringify(briefing) !== JSON.stringify(spec.briefing)) {
        spec = { ...spec, briefing };
        await this.host.applyBriefing(briefing);
      }
    }
    if (!session.document?.id || session.changed(spec)) {
      const saved = await session.save(spec);
      this.warnings = saved.warnings;
      await this.host.afterSave?.(saved);
    }
    return session.version;
  }

  async #run(work) {
    this.busy = true;
    this.error = null;
    this.render();
    try {
      this.publication = await work();
      return this.publication;
    } catch (error) {
      this.error = describeSiError(error);
      return null;
    } finally {
      this.busy = false;
      this.render();
    }
  }
}
