import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { bindMobileSheetResize, clampSheetHeight } from "../js/mobile-sheet-resize.js";

test("mobile sheet heights stay between the navigation and top bar", () => {
  assert.equal(clampSheetHeight(1000, 700, 60, 800), 640);
  assert.equal(clampSheetHeight(1, 700, 60, 800), 176);
  assert.equal(clampSheetHeight(350, 700, 60, 800), 350);
  assert.equal(clampSheetHeight(100, 100, 60, 800), 40);
});

test("sheet handle supports pointer and keyboard resize without affecting desktop", () => {
  const handlers = new Map();
  const windowHandlers = new Map();
  const styles = {};
  let compact = true;
  const handle = { addEventListener: (type, cb) => handlers.set(type, cb), setPointerCapture() {} };
  const windowRef = { innerHeight: 800, addEventListener: (type, cb) => windowHandlers.set(type, cb), removeEventListener: (type) => windowHandlers.delete(type) };
  const documentRef = { body: { style: { setProperty: (key, value) => { styles[key] = value; } } }, querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 60 }) }) };
  const sheet = { getBoundingClientRect: () => ({ bottom: 700, height: 300 }) };
  bindMobileSheetResize({ handle, sheet, variable: "--sheet", documentRef, windowRef, isCompact: () => compact });
  handlers.get("keydown")({ key: "ArrowUp", preventDefault() {} });
  assert.equal(styles["--sheet"], "332px");
  handlers.get("pointerdown")({ button: 0, pointerId: 1, clientY: 300, preventDefault() {} });
  windowHandlers.get("pointermove")({ pointerId: 1, clientY: 200 });
  assert.equal(styles["--sheet"], "400px");
  windowHandlers.get("pointerup")({ pointerId: 1 });
  assert.equal(windowHandlers.size, 0);
  compact = false;
  handlers.get("keydown")({ key: "ArrowDown", preventDefault() { throw new Error("desktop should not resize"); } });
  assert.equal(styles["--sheet"], "400px");
});

test("compact sheets share handles, reserve navigation, and suppress desktop dock controls", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");
  const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(html, /id="mobile-dialog-resize"/);
  assert.match(html, /id="mobile-utility-resize"/);
  assert.match(css, /#dialog-dock, #utility-open-modal \{ display:none !important;/);
  assert.match(css, /--mobile-sheet-bottom:calc\(124px \+ env\(safe-area-inset-bottom\)\)/);
  assert.match(ui, /if \(this\.mobileMedia\.matches\) this\.dialog\.show\(\)/);
});
