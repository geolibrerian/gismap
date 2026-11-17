// The page side of maps saved in GISMap SI: `/m/<id>` (editor, or read-only), `/m/<id>?p=<pid>`
// (the viewer of a publication), Project → Save to GISMap SI, the GISMap SI bar, the Publish
// dialog, and what the AI Map assistant gets from SI. The connection is the tab's one
// SiConnection; the conversions and SI calls live in si-maps.js.

import { SiMapsClient, SiMapSession, describeSiError } from "./si-maps.js?v=0.72.0-si-maps";
import { SiPublishPanel } from "./si-publish-panel.js?v=0.72.0-si-maps";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

export class SiMapWorkspace {
  /**
   * `route`: parseSiMapRoute() or null. `mapSpec`: gisMapOnline.mapSpec. `ui`: the UIController
   * (toast, error, activateSharedEmbed, openBriefingDocument). `runtime`: the ApplicationRuntime.
   * `briefing`: gisMapOnline.briefing. `figures()`: BriefingSlides.figures().
   */
  constructor({ route, connection, mapSpec, ui, runtime, briefing, figures }) {
    Object.assign(this, { route, connection, mapSpec, ui, runtime, briefing, figures });
    this.client = new SiMapsClient(connection);
    this.session = new SiMapSession({ client: this.client, route });
    this.context = null;
    this.contextLoad = null;
    this.status = "";
    this.issues = [];
    this.bar = null;
    this.publishPanel = null;
    connection.subscribe((change) => {
      if (!change.connected) { this.context = null; this.contextLoad = null; }
      if (!change.connected && change.reason === "expired") this.#setStatus("Your GISMap SI connection expired or was revoked.");
      this.#renderBar();
    });
  }

  /** Opens the `/m/` route, if this address is one. */
  async start() {
    if (!this.route) return;
    if (this.route.publicationId) return this.#openViewer();
    if (this.route.app === "ai-map") await this.#openAiMap();
    this.#renderBar();
    if (!this.connection.connected) {
      this.#setStatus("This map is saved in GISMap SI. Sign in to open it.");
      return;
    }
    await this.#openEditor();
  }

  /** What the AI Map assistant gets while signed in: the open map's SI reference data. */
  assistantSi() {
    if (!this.connection.connected) return null;
    if (this.session.canEdit && !this.context && !this.contextLoad) void this.loadContext().catch(() => {});
    return { context: this.context };
  }

  /** The SI tools' host (map-assistant.js siAssistantTools). */
  assistantTools() {
    return {
      findDatasets: async (search) => {
        let workspaceId = this.session.workspaceId;
        if (!workspaceId) workspaceId = (await this.client.workspaces())?.workspaces?.[0]?.id;
        if (!workspaceId) throw Object.assign(new Error("Your GISMap SI connection has no workspace."), { hint: "Sign in to GISMap SI with an account that belongs to a workspace." });
        return (await this.client.datasets({ workspaceId, search }))?.datasets || [];
      },
      context: () => this.loadContext(),
      openPublishPanel: () => { void this.openPublish(); },
      verify: async (publicationId) => {
        const id = publicationId || this.publishPanel?.publication?.id || (await this.client.publications(this.#requireMap()))?.publications?.find((item) => !item.revokedAt)?.id;
        if (!id) throw Object.assign(new Error("This map hasn't been published yet."), { hint: "Call si_publish_preview so the user can publish first." });
        return this.client.verify(this.#requireMap(), id);
      },
    };
  }

  /** GET /maps/{id}/context, once per map (for editors only). */
  async loadContext({ refresh = false } = {}) {
    const mapId = this.#requireMap();
    if (!this.session.canEdit) throw Object.assign(new Error("Only editors of this map can read its GISMap SI context."), { code: "READ_ONLY" });
    if (this.context && !refresh) return this.context;
    this.contextLoad ??= this.client.context(mapId).then((context) => { this.context = context; return context; }).finally(() => { this.contextLoad = null; });
    return this.contextLoad;
  }

  async signIn() {
    try {
      const user = await this.connection.signIn();
      if (!user) return null;
      this.ui.toast(`Signed in to GISMap SI as ${user.email || user.displayName}.`);
      if (this.route && !this.route.publicationId && !this.session.document) await this.#openEditor();
      return user;
    } catch (error) {
      this.ui.error(error.message);
      return null;
    } finally { this.#renderBar(); }
  }

  async signOut() {
    await this.connection.signOut();
    this.ui.toast("Signed out of GISMap SI.");
  }

  /** Saves the editor's map: POST for a new one, then PUT with If-Match. */
  async save() {
    if (!this.connection.connected && !(await this.signIn())) return null;
    this.issues = [];
    this.#setStatus("Saving…");
    try {
      const isNew = !this.session.document?.id;
      const result = await this.session.save(this.mapSpec.fromCurrent());
      await this.afterSave(result);
      if (isNew) this.#adoptRoute(this.session.mapId);
      this.#setStatus(result.warnings.length ? "Saved, with changes made by GISMap SI." : `Saved · version ${this.session.version}`);
      return result;
    } catch (error) {
      this.#showError(error);
      return null;
    }
  }

  /** After a save SI changed (warnings), the editor shows what SI kept. */
  async afterSave(result) {
    this.issues = result.warnings.map((message) => ({ message }));
    if (result.warnings.length) this.ui.toast(`GISMap SI changed this map when saving: ${result.warnings.join(" ")}`);
    if (result.reloaded) await this.mapSpec.load(result.spec, { replace: true, showIssues: false }).ready;
    this.#renderBar();
  }

  /** Project → Save to GISMap SI (a map not yet in SI), or a save of the open one. */
  async saveToSi() {
    if (!this.session.document && !this.connection.connected && !(await this.signIn())) return;
    await this.save();
  }

  /** Opens the Publish dialog (the assistant's si_publish_preview does only this). */
  async openPublish() {
    const dialog = this.#publishDialog();
    if (!dialog.open) dialog.showModal?.();
    this.publishPanel ??= new SiPublishPanel({
      connection: this.connection,
      session: this.session,
      client: this.client,
      currentSpec: () => this.mapSpec.fromCurrent(),
      figures: () => this.figures?.() || [],
      applyBriefing: (briefing) => this.briefing.load(briefing, { activate: false }).ready,
      afterSave: async (result) => { const isNew = this.route?.mapId !== this.session.mapId; await this.afterSave(result); if (isNew) this.#adoptRoute(this.session.mapId); },
      signIn: () => this.signIn(),
      copy: (text) => navigator.clipboard?.writeText(text).then(() => this.ui.toast("Share link copied.")),
      context: () => (this.session.canEdit ? this.loadContext() : Promise.resolve(null)),
    });
    await this.publishPanel.open(dialog.querySelector("[data-si-publish-body]"));
  }

  async #openEditor() {
    this.#setStatus("Opening from GISMap SI…");
    try {
      const { spec } = await this.session.open();
      await this.mapSpec.load(spec, { replace: true }).ready;
      this.#setStatus(this.session.canEdit ? `Version ${this.session.version}` : "Read-only: you can view this map but not save it.");
      if (this.session.canEdit && this.route.app === "ai-map") await this.loadContext().catch(() => {});
    } catch (error) {
      this.#showError(error);
    }
    this.#renderBar();
  }

  async #openViewer() {
    document.body.classList.add("si-map-viewer");
    try {
      const { spec } = await this.session.open();
      const briefing = spec.briefing?.slides?.some((slide) => !slide.hidden) ? spec.briefing : null;
      this.ui.activateSharedEmbed(briefing ? "briefing" : "map");
      await this.mapSpec.load(spec, { replace: true }).ready;
      if (this.session.publication?.sourcesChangedSince) this.#viewerNotice("The data has changed since this was published.");
      if (briefing) await this.ui.openBriefingDocument(this.briefing.get() || briefing, { present: true });
    } catch (error) {
      this.#viewerNotice(describeSiError(error).message, { error: true });
    }
  }

  async #openAiMap() {
    try { await this.runtime.runTool("application.preset.apply", { preset: "ai-map" }); } catch (error) { console.warn("The AI Map layout could not be opened.", error); }
  }

  #requireMap() {
    if (!this.session.mapId) throw Object.assign(new Error("No GISMap SI map is open."), { hint: "Open the map from GISMap SI (gismap.online/m/<id>), or save this one to GISMap SI first." });
    return this.session.mapId;
  }

  // The address becomes /m/<id> once the map has an id, so a reload reopens it from SI.
  #adoptRoute(mapId) {
    if (!mapId || location.pathname.endsWith(`/m/${mapId}`)) return;
    const folder = location.pathname.replace(/\/m\/[^/]+\/?$/, "/").replace(/[^/]*$/, "");
    if (!document.querySelector("base")) {
      const base = document.createElement("base");
      base.href = folder;
      document.head.prepend(base);
    }
    history.replaceState(null, "", `${folder}m/${encodeURIComponent(mapId)}`);
    this.route = { mapId, publicationId: null, app: null };
    this.session.route = this.route;
  }

  #showError(error) {
    const described = describeSiError(error);
    this.issues = described.issues || [];
    this.#setStatus(described.message);
    if (described.kind !== "signin") this.ui.error(described.message);
  }

  #setStatus(text) {
    this.status = text;
    this.#renderBar();
  }

  #renderBar() {
    if (!this.route && !this.session.document) return;
    if (!this.bar) {
      this.bar = document.createElement("div");
      this.bar.className = "si-map-bar";
      this.bar.setAttribute("role", "region");
      this.bar.setAttribute("aria-label", "GISMap SI");
      document.body.append(this.bar);
      this.bar.addEventListener("click", (event) => {
        const action = event.target.closest("[data-si-bar]")?.dataset.siBar;
        if (action === "sign-in") void this.signIn();
        if (action === "sign-out") void this.signOut();
        if (action === "save") void this.save();
        if (action === "publish") void this.openPublish();
      });
    }
    const user = this.connection.user;
    const editable = this.connection.connected && (this.session.canEdit || !this.session.document);
    const title = this.session.document?.title || "GISMap SI map";
    this.bar.innerHTML = `<strong class="si-map-bar__title">${escapeHtml(title)}</strong>
      <span class="si-map-bar__status" role="status">${escapeHtml(this.status)}</span>
      ${this.issues.length ? `<ul class="si-map-bar__issues">${this.issues.map((issue) => `<li>${escapeHtml(issue.message)}${issue.layerId ? ` <small>(layer ${escapeHtml(issue.layerId)})</small>` : ""}</li>`).join("")}</ul>` : ""}
      <span class="si-map-bar__actions">
        ${editable ? `<button type="button" data-si-bar="save">Save</button><button type="button" class="button--primary" data-si-bar="publish">Publish…</button>` : ""}
        ${user ? `<small title="Connected to GISMap SI">${escapeHtml(user.email || user.displayName)}</small><button type="button" class="link-button" data-si-bar="sign-out">Sign out</button>` : `<button type="button" class="button--primary" data-si-bar="sign-in">Sign in to GISMap SI</button>`}
      </span>`;
  }

  #viewerNotice(text, { error = false } = {}) {
    const notice = document.createElement("div");
    notice.className = `si-map-notice${error ? " si-map-notice--error" : ""}`;
    notice.setAttribute("role", error ? "alert" : "status");
    notice.textContent = text;
    document.body.append(notice);
  }

  #publishDialog() {
    let dialog = document.querySelector("#si-publish-dialog");
    if (dialog) return dialog;
    dialog = document.createElement("dialog");
    dialog.id = "si-publish-dialog";
    dialog.className = "si-publish-dialog";
    dialog.innerHTML = `<form method="dialog" class="si-publish-dialog__close"><button type="submit" aria-label="Close">×</button></form><div data-si-publish-body></div>`;
    document.body.append(dialog);
    return dialog;
  }
}
