/**
 * Owns the physical DOM location of panels that can appear on more than one
 * surface. Moving one registered node is intentional: a panel is never cloned
 * or rendered into a second live container.
 */
export class PanelManager {
  constructor({ documentRef = globalThis.document } = {}) {
    this.document = documentRef;
    this.records = new Map();
  }

  register(id, element, { shell = null } = {}) {
    if (!id || !element) return null;
    const current = this.records.get(id);
    if (current?.element === element) {
      if (shell) current.shell = shell;
      return current;
    }
    const record = {
      id,
      element,
      shell,
      home: { parent: element.parentElement, next: element.nextSibling },
      surface: "home",
      shellHiddenBeforeMove: null,
    };
    this.records.set(id, record);
    element.dataset.panelManagerId = id;
    element.dataset.panelSurface = "home";
    return record;
  }

  move(id, host, { surface, hideShell = false, replaceHost = false } = {}) {
    const record = this.records.get(id);
    if (!record?.element || !host) return false;
    if (replaceHost) {
      [...host.children].forEach((child) => {
        if (child !== record.element) child.remove();
      });
    }
    if (hideShell && record.shell) {
      if (record.shellHiddenBeforeMove == null) record.shellHiddenBeforeMove = record.shell.hidden;
      record.shell.hidden = true;
    }
    host.append(record.element);
    record.surface = surface || "alternate";
    record.element.dataset.panelSurface = record.surface;
    host.dataset.panelOwner = id;
    return true;
  }

  restore(id, { restoreShell = true } = {}) {
    const record = this.records.get(id);
    if (!record?.element) return false;
    const previousHost = record.element.parentElement;
    const { parent, next } = record.home;
    if (parent) parent.insertBefore(record.element, next?.isConnected && next.parentElement === parent ? next : null);
    if (previousHost?.dataset.panelOwner === id) delete previousHost.dataset.panelOwner;
    record.surface = "home";
    record.element.dataset.panelSurface = "home";
    if (restoreShell && record.shell && record.shellHiddenBeforeMove != null) {
      record.shell.hidden = record.shellHiddenBeforeMove;
    }
    record.shellHiddenBeforeMove = null;
    return true;
  }

  surface(id) { return this.records.get(id)?.surface || null; }
  isOn(id, surface) { return this.surface(id) === surface; }
}
