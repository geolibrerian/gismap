import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { normalizeMobileWorkflow } from "../js/mobile-feed-store.js";
import { APPLICATION_PRESETS } from "../js/application-config.js";

test("mobile workflow state normalizes independently of desktop dashboards", () => {
  const mobile = normalizeMobileWorkflow({
    defaultRoute: "watchlist",
    feedPreferences: { scope: "attention", sort: "priority" },
    fieldTasks: [{ id: "one", title: "Inspect" }],
  });
  assert.equal(mobile.defaultRoute, "watchlist");
  assert.equal(mobile.feedPreferences.scope, "attention");
  assert.equal(mobile.fieldTasks[0].title, "Inspect");
  assert.deepEqual(normalizeMobileWorkflow({ fieldTasks: "bad" }).fieldTasks, []);
});

test("Atlas starts with Clean Light", () => {
  assert.equal(APPLICATION_PRESETS.atlas.skin, "clean-light");
});

test("mobile navigation exposes focused workflows", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const route of ["briefing", "map", "tours", "more"]) {
    assert.match(html, new RegExp(`data-mobile-workflow="${route}"`));
  }
  assert.match(html, /class="mobile-panel-nav__field" href="\/field\/"[\s\S]*?<small>Field<\/small>/);
  assert.doesNotMatch(html, /data-mobile-workflow="updates"/);
  assert.match(html, /id="mobile-workflow-root"/);
});

test("mobile tours own the active nav state instead of highlighting Map", async () => {
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(router, /if \(route === "map" \|\| route === "tours" \|\| route === "briefing"\) \{\s*this\.#hideRoot\(\);/);
  assert.match(router, /"mobile:workflow-route"/);
  assert.match(ui, /publish\("mobile:workflow-route", \{ route: "tours" \}\)/);
});

test("mobile chapter editing hides advanced fields in a fold by default", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /class="atlas-chapter-advanced"\$\{this\.mobileMedia\.matches \? "" : " open"\}/);
  assert.match(ui, /<summary>More chapter options<\/summary>/);
});

test("mobile menu nests public workflows below the standard tools", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(ui, /dashboard-builder.*map-presentation/s);
  assert.match(ui, /mobile-workflows-menu.*Modes.*Briefing.*Tours.*Field Mode.*Map tools/s);
  assert.match(ui, /mobileMenu\.append\(workflows\)/);
  assert.doesNotMatch(ui, /Free workflows/);
  assert.doesNotMatch(ui.match(/workflows\.innerHTML[^;]+/s)?.[0] || "", /Updates|Compare|Watchlist/);
  // Opening a workflow never replaces the project's chosen skin.
  assert.doesNotMatch(ui, /skin: returningTo(Tour|Briefing)/);
});

test("Field Mode is a styled top-level option rather than a browser-default menu link", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(html, /class="menu__link menu__link--field" href="\/field\//);
  assert.match(router, /workflow-grid__field" href="\/field\//);
  assert.match(css, /\.menu__content \.menu__link \{ display:grid/);
  assert.match(css, /\.mobile-panel-nav :is\(button,a\)/);
});

test("Field Mode reserves its offline identity and QR scanner for actual offline collection", async () => {
  const fieldHtml = await readFile(new URL("../field/index.html", import.meta.url), "utf8");
  const fieldJs = await readFile(new URL("../field/field-mode.js", import.meta.url), "utf8");
  const fieldCss = await readFile(new URL("../field/field-mode.css", import.meta.url), "utf8");
  const worker = await readFile(new URL("../field/service-worker.js", import.meta.url), "utf8");
  assert.doesNotMatch(fieldHtml, /FIELD COLLECTION/);
  assert.match(fieldHtml, /data-open-qr-import>Scan QR/);
  assert.match(fieldHtml, /data-start-qr-camera>Scan with camera/);
  assert.match(fieldHtml, /data-import-qr-camera-image[^>]*capture="environment"/);
  assert.match(fieldHtml, /data-import-geopayload/);
  assert.match(fieldHtml, /data-accept-geopayload/);
  assert.match(fieldJs, /classList\.toggle\("is-offline", offline\)/);
  assert.match(fieldJs, /new globalThis\.BarcodeDetector/);
  assert.match(fieldJs, /scanQrWithCamera/);
  assert.match(fieldJs, /previewGeoPayload/);
  assert.match(fieldJs, /encodeGeoPayload/);
  assert.match(fieldCss, /\.field-app\.is-offline \.field-header__brand-online::after/);
  assert.match(worker, /gismap-field-v4/);
  assert.match(worker, /geopayload\.js/);
  assert.match(worker, /caches\.delete/);
});

test("mobile navigation keeps the menu exclusive and Map active while its tools are open", async () => {
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(router, /!menuOpen && button\.dataset\.mobileWorkflow === this\.route/);
  assert.match(router, /"mobile:panel-active"/);
  assert.match(ui, /prepareMobileWorkflow\(route\)/);
  assert.match(ui, /setPresentation\(\{ \.\.\.current, template: "standard" \}\)/);
});

test("map tool strip is mobile-only and limited to the Map route", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /mobile-panel-nav, \.mobile-map-tool-strip \{ display: none; \}/);
  assert.match(css, /body\.mobile-map-route \.mobile-map-tool-strip[\s\S]*?display: grid/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /\.mobile-map-tool-strip button svg/);
  assert.doesNotMatch(html.match(/<nav class="mobile-map-tool-strip"[\s\S]*?<\/nav>/)?.[0] || "", /<span>[⌕◇✎▱◎]<\/span>/);
});

test("free workflows provide QR sharing while account workflows remain gated", async () => {
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const pdf = await readFile(new URL("../js/pdf-document.js", import.meta.url), "utf8");
  const slides = await readFile(new URL("../js/briefing-slides.js", import.meta.url), "utf8");
  assert.match(router, /share by QR/);
  assert.match(router, /With an account · coming soon/);
  assert.match(ui, /#drawBrandedQrCard\(canvas, url, \{ title, \.\.\.card/, "workflow shares draw the branded QR card for the complete link");
  assert.match(ui, /brandedQrCanvas\(url, \{ canvas/);
  assert.match(pdf, /QRCode\.toCanvas\(qrCanvas, url/);
  assert.doesNotMatch(ui, /briefingShare\.textContent = "Share QR"/, "Briefing has one share entry point");
  assert.match(slides, /data-slides-share[^>]*data-mobile-bar/, "Share & PDF remains available in the mobile action bar");
});

test("mobile Atlas authoring uses a content-sized bottom workspace above its controls", async () => {
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(ui, /presentationSheet:\s*true/);
  assert.match(ui, /compactAtlas \? "Present" : "Present tour"/);
  assert.match(css, /body\.mobile-presentation-panel-open \.utility-panel[\s\S]*?height:60dvh/);
  assert.match(css, /\.app-dialog--presentation-sheet[\s\S]*?height:60dvh/);
  assert.match(css, /\.app-dialog--presentation-sheet \.dialog__shell \{ grid-template-rows:minmax\(0,1fr\) auto/);
  assert.match(css, /\.app-dialog--presentation-sheet \.dialog__actions button \{ flex:0 0 auto; width:auto; min-width:88px; height:40px/);
  // Briefing and Tour sheets sit on the docked action bar, open at half height and drag to the top bar.
  assert.match(css, /#app\[data-presentation="briefing"\] \.sidebar,[\s\S]*?#app\[data-presentation="atlas"\] \.sidebar \{ bottom:calc\(124px \+ env\(safe-area-inset-bottom\)\); height:var\(--mobile-sheet-height, 50dvh\)/);
  assert.match(await readFile(new URL("../index.html", import.meta.url), "utf8"), /id="mobile-action-bar"/);
  assert.match(css, /#app\[data-presentation="atlas"\] \.mode-dashboard--atlas \{ align-content:start; grid-auto-rows:max-content/);
  assert.match(css, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  assert.match(css, /\.atlas-actions button \{ height:40px; min-height:0; max-height:40px/);
});

test("mobile map tools open in a content-sized, resizable sheet capped at sixty percent", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(html, /id="mobile-drawer-handle"/);
  assert.match(ui, /const max = presentationSheet\(\) \? sheetBottom - topLimit : window\.innerHeight \* 0\.6;/);
  assert.match(ui, /Math\.min\(max, Math\.max\(window\.innerHeight \* 0\.2, height\)\)/);
  assert.match(css, /height: var\(--mobile-tool-drawer-height, auto\);[\s\S]*?max-height: 60dvh/);
});

test("Clean Light keeps the full-screen mobile menu legible", async () => {
  const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");
  assert.match(css, /data-skin="clean-light"\] \.mobile-menu-drawer \{ color:var\(--ink\); background:var\(--surface\); \}/);
  assert.match(css, /data-skin="clean-light"\] \.mobile-menu-drawer \.menu__trigger/);
});

test("on desktop the Tasks screen is a right-panel tab, so docked dialogs tab beside it", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  const router = await readFile(new URL("../js/mobile-workflow-router.js", import.meta.url), "utf8");
  assert.match(html, /id="utility-tasks-content"[^>]*data-utility-pane="tasks"/);
  assert.match(ui, /this\.utilityTasksOpen \? \[\{ id: "tasks", label: "Field tasks" \}\]/);
  assert.match(ui, /dockWorkflowPanel\(open\)/);
  assert.match(router, /if \(!compact\) this\.dockWorkflow\?\.\(true\);/);
  assert.match(router, /"workflow:panel-closed"/);
});
