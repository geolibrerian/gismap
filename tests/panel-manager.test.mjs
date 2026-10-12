import test from "node:test";
import assert from "node:assert/strict";
import { PanelManager } from "../js/panel-manager.js";

class FakeElement {
  constructor(name) { this.name = name; this.children = []; this.parentElement = null; this.dataset = {}; this.hidden = false; }
  get isConnected() { return Boolean(this.parentElement); }
  get nextSibling() {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return this.parentElement.children[index + 1] || null;
  }
  append(child) { this.insertBefore(child, null); }
  insertBefore(child, next) {
    child.parentElement?.removeChild(child);
    const index = next ? this.children.indexOf(next) : -1;
    if (index < 0) this.children.push(child); else this.children.splice(index, 0, child);
    child.parentElement = this;
  }
  removeChild(child) {
    const index = this.children.indexOf(child);
    if (index >= 0) this.children.splice(index, 1);
    child.parentElement = null;
  }
  remove() { this.parentElement?.removeChild(this); }
}

test("a managed panel has exactly one DOM owner and returns to its original order", () => {
  const home = new FakeElement("home");
  const before = new FakeElement("before");
  const panel = new FakeElement("panel");
  const after = new FakeElement("after");
  const utility = new FakeElement("utility");
  const staleCopy = new FakeElement("stale");
  const shell = new FakeElement("shell");
  home.append(before); home.append(panel); home.append(after); utility.append(staleCopy);
  const manager = new PanelManager({ documentRef: null });
  manager.register("intelligence", panel, { shell });

  assert.equal(manager.move("intelligence", utility, { surface: "utility", hideShell: true, replaceHost: true }), true);
  assert.deepEqual(utility.children, [panel]);
  assert.equal(home.children.includes(panel), false);
  assert.equal(shell.hidden, true);
  assert.equal(manager.isOn("intelligence", "utility"), true);

  manager.restore("intelligence");
  assert.deepEqual(home.children, [before, panel, after]);
  assert.equal(utility.children.length, 0);
  assert.equal(shell.hidden, false);
  assert.equal(manager.surface("intelligence"), "home");
});
