import { COMPACT_QUERY } from "./viewport.js?v=0.18.2";

const MOBILE_PANEL_IDS = ["places-panel", "bookmarks-panel", "draw-panel", "layers-panel", "intelligence-panel"];
export const MOBILE_PANEL_QUERY = COMPACT_QUERY;

/**
 * Owns the compact, single-panel tool surface used by phones and portrait
 * tablets. Desktop dashboard placement is deliberately outside this manager.
 */
export class MobilePanelManager {
  constructor({ documentRef = globalThis.document, panelManager = null, media = null } = {}) {
    this.document = documentRef;
    this.panelManager = panelManager;
    this.media = media || globalThis.matchMedia?.(MOBILE_PANEL_QUERY) || { matches: false };
    this.activePanelId = null;
  }

  get compact() { return Boolean(this.media.matches); }

  enter() {
    this.document.body?.classList?.add("mobile-panel-mode");
    for (const type of ["places", "bookmarks", "draw", "intelligence", "layers"]) {
      this.panelManager?.restore(`workspace:${type}`);
    }
    this.panelManager?.restore("content:intelligence", { restoreShell: false });
    this.panelManager?.restore("content:draw", { restoreShell: false });
    this.close();
  }

  leave() {
    this.activePanelId = null;
    this.document.body?.classList?.remove("mobile-panel-mode", "mobile-places-active");
    this.document.querySelectorAll?.("[data-mobile-panel]").forEach((button) => {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    });
    MOBILE_PANEL_IDS.forEach((id) => {
      const panel = this.document.getElementById?.(id);
      panel?.classList?.remove("is-mobile-active");
      if (panel) panel.hidden = false;
    });
  }

  activate(panelId, { toggle = true } = {}) {
    if (!this.compact || !MOBILE_PANEL_IDS.includes(panelId)) return null;
    const next = toggle && this.activePanelId === panelId ? null : panelId;
    this.activePanelId = next;
    this.document.querySelectorAll?.("[data-mobile-panel]").forEach((button) => {
      const active = button.dataset.mobilePanel === next;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    MOBILE_PANEL_IDS.forEach((id) => {
      const panel = this.document.getElementById?.(id);
      if (!panel) return;
      const active = id === next;
      panel.classList.toggle("is-mobile-active", active);
      panel.hidden = !active;
      if (active) panel.open = true;
    });
    this.document.body?.classList?.toggle("mobile-places-active", next === "places-panel");
    return next;
  }

  close() {
    this.activePanelId = null;
    this.document.querySelectorAll?.("[data-mobile-panel]").forEach((button) => {
      button.classList.remove("is-active");
      button.setAttribute("aria-pressed", "false");
    });
    MOBILE_PANEL_IDS.forEach((id) => {
      const panel = this.document.getElementById?.(id);
      panel?.classList?.remove("is-mobile-active");
      if (panel) panel.hidden = true;
    });
    this.document.body?.classList?.remove("mobile-places-active");
  }
}
