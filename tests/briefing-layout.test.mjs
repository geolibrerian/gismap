import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");
const map = readFileSync(new URL("../js/engines/arcgis/arcgis-engine.js", import.meta.url), "utf8");
const slides = readFileSync(new URL("../js/briefing-slides.js", import.meta.url), "utf8");
const pdf = readFileSync(new URL("../js/briefing-pdf.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../css/app.css", import.meta.url), "utf8");

test("briefing context has a map-owned host independent of the sidebar", () => {
  assert.match(html, /id="briefing-context-host"/);
  assert.match(ui, /briefing-context-host/);
  assert.match(css, /\.briefing-context-host:empty/);
  assert.match(css, /sidebar-collapsed\[data-briefing-context-dock="left"\] \.briefing-context[\s\S]*?left:0/);
});

test("briefing supports scoped feature selection and copyable representative coordinates", () => {
  assert.match(ui, /data-briefing-use-all/);
  assert.match(ui, /data-briefing-include/);
  assert.match(ui, /data-copy-briefing-coordinates/);
  assert.match(map, /representativePoint\(geometry\)/);
  assert.match(map, /geographicCoordinates\(geometry\)/);
});

test("briefing PDF maps match the live slide focus and use the branded QR card", () => {
  assert.match(map, /if \(prepare\) await prepare\(index, target\)/, "capture supports slide-specific map preparation");
  assert.match(slides, /prepare: \(index\) => this\.showSlideMap\(mapSlides\[index\]\)/, "the selected feature is highlighted before each snapshot");
  assert.match(slides, /await mapController\.highlightFeature/, "capture waits until the layer highlight exists");
  assert.match(pdf, /brandedQrImage\(link/, "the cover uses the same branded QR card as sharing");
});

test("briefing slide authoring keeps the outline and selected settings visible together", () => {
  assert.doesNotMatch(ui, /briefingShare\.textContent = "Share QR"/, "the header does not duplicate the Share & PDF action");
  assert.match(slides, /briefing-slides__authoring/, "the slide outline has its own pane");
  assert.match(slides, /briefing-slide-item__delete[^>]*data-slide-delete/, "each outline row has a delete button beside its other actions");
  assert.match(slides, /Delete .*This cannot be undone/, "deleting from the outline requires confirmation");
  assert.match(css, /briefing-slides-tab \.briefing-slides \{ grid-template-columns:/, "desktop authoring docks settings beside the outline");
  assert.match(css, /\.briefing-slide-list \{[^}]*overflow-y:auto/, "long slide lists scroll independently");
  assert.match(css, /\.briefing-slide-editor \{[^}]*overflow:auto/, "selected slide settings scroll independently");
});

test("desktop and globe map controls can collapse and reopen", () => {
  assert.match(html, /id="map-navigation-toggle"/);
  assert.match(html, /id="globe-navigation-close"/);
  assert.match(css, /\.map-nav__toggle/);
  assert.match(css, /body\.map-tools-collapsed/);
});

test("mobile map tools toggle sits in the top bar, separated from the title", () => {
  // The shell drops its stacking context so the toggle can sit in the top bar above the map.
  assert.match(css, /\.map-nav-shell \{ z-index:auto; top:8px; right:8px; justify-items:end; transform:none; \}/);
  assert.match(css, /\.map-nav__toggle,\s*body\.mobile-map-tools-open \.map-nav__toggle \{\s*position:fixed;\s*z-index:69;\s*top:calc\(4px \+ env\(safe-area-inset-top\)\);/);
  assert.match(css, /\.map-nav__toggle::before \{ content:""; position:absolute;[^}]*left:-9px; width:1px;/);
  assert.match(css, /body:not\(\.mobile-map-route\) \.map-nav-shell \{ display:none; \}/);
});

test("a saved view replaces grid-cell framing, and the policy select works", () => {
  // Grid and data-driven slides frame themselves only until a view is pinned.
  assert.match(slides, /#autoFraming\(slide\) \{[\s\S]*?cameraPolicy === "fixed"\) return null;[\s\S]*?"grid-atlas"/);
  assert.match(slides, /const framing = this\.#autoFraming\(slide\);\s*if \(framing\?\.kind === 'grid'\)/);
  assert.match(slides, /saveCameraToSelected\(\) \{[\s\S]*?framing \? \{ \.\.\.slide\.generatedBy, cameraPolicy: "fixed" \}/);
  assert.match(slides, /Frame its grid cell/);
  // on() hands handlers the element, not the event.
  assert.match(slides, /on\("\[data-slide-camera-policy\]", "change", \(select\) => \{[\s\S]*?cameraPolicy:select\.value/);
  assert.doesNotMatch(slides, /cameraPolicy:event\.target\.value/);
});

test("hidden right-panel panes stay hidden; briefings can be closed, discarded and lose a removed layer", () => {
  const css = readFileSync(new URL("../css/fieldwork.css", import.meta.url), "utf8");
  assert.match(css, /\.utility-panes > \[data-utility-pane\]\[hidden\] \{ display: none !important; \}/, ".briefing-inspector's grid must not override [hidden]");
  assert.match(ui, /data-briefing-close[^>]*>Close<\/button><button type="button" data-briefing-discard[^>]*>Discard briefing…/);
  assert.match(ui, /#discardBriefing\(\) \{[\s\S]*?globalThis\.confirm\([\s\S]*?patchPresentation\(\{ briefing: null \}\)/);
  assert.match(ui, /#teardownBriefingV2\(\) \{[\s\S]*?#clearBriefingFeatureContext\(\);\s*document\.querySelector\("#utility-briefing-content"\)\?\.replaceChildren\(\);/);
  // The layer:removed handler runs from initialize(), not the disabled contextual workspace.
  const initContext = ui.slice(ui.indexOf("#initContextualWorkspace() {"), ui.indexOf("\n  }\n", ui.indexOf("#initContextualWorkspace() {")));
  assert.doesNotMatch(initContext, /#teardownBriefingV2/);
  assert.match(ui, /this\.events\.subscribe\("layer:removed", \(\{ uid \} = \{\}\) => \{[\s\S]*?this\.#teardownBriefingV2\(\);\s*this\.#renderPresentationDashboard/);
});

test("one prominent Add a new slide button opens a type chooser on the new slide", () => {
  // One shared button for phone and desktop layouts; the old template dropdown is gone.
  assert.match(slides, /class="button--primary briefing-add-slide" data-add-slide\$\{[\s\S]*?\}><span aria-hidden="true">\+<\/span> Add a new slide<\/button>/);
  assert.doesNotMatch(slides, /data-slide-template>/);
  assert.match(slides, /#addNewSlide\(\) \{[\s\S]*?this\.#addTemplate\("map-narrative"\);\s*this\.typeChooserFor = this\.selectedSlideId;/);
  assert.match(slides, /on\("\[data-add-slide\]", "click", \(\) => this\.#addNewSlide\(\)\);/);
  assert.match(slides, /<summary>More ways to add slides<\/summary>/);
  assert.match(slides, /data-slide-type="\$\{option\.id\}"[^`]*\$\{option\.kind === "planned" \? " disabled" : ""\}/);
  assert.match(slides, /#chooseSlideType\(slideId, typeId\) \{[\s\S]*?convertSlide\(this\.briefing, slideId, type\.template[\s\S]*?removeSlide\(this\.briefing, slideId\)/);
});

test("the check list follows typing, the Slide workspace scrolls, and the dock offers Save", () => {
  const css = readFileSync(new URL("../css/fieldwork.css", import.meta.url), "utf8");
  const project = readFileSync(new URL("../js/project.js", import.meta.url), "utf8");
  // Debounced saves refresh "things to check" without redrawing the editor.
  assert.match(slides, /#saveSoon\(change\) \{[\s\S]*?this\.#refreshIssues\(\);/);
  assert.match(slides, /<div data-slides-issues>\$\{this\.#issuesMarkup\(issues\)\}<\/div>/);
  // A nested editor with overscroll-behavior: contain swallowed wheel scrolling of the pane.
  assert.match(css, /\.briefing-inspector :is\(\.briefing-slide-editor[^)]*\) \{ overflow: visible; overscroll-behavior: auto;/);
  assert.match(project, /isSaved\(\) \{\s*return Boolean\(this\.#readStore\(\)\[this\.current\.id\]\);/);
  assert.match(ui, /data-dock-save>Save<\/button>/);
  assert.match(ui, /if \(!this\.projectManager\.isSaved\(\)\) \{ this\.#saveProjectDialog\(\); return; \}/);
  assert.match(ui, /button\.textContent = saved \? "Saved ✓" : "Save";/);
});

test("media slides render a slideshow with a place button, and the player can show the place", () => {
  const player = readFileSync(new URL("../js/briefing-player.js", import.meta.url), "utf8");
  assert.match(slides, /#galleryHtml\(images, slideId\) \{[\s\S]*?aria-roledescription="carousel"[\s\S]*?data-gallery-track tabindex="0"/);
  assert.match(slides, /data-slide-place="\$\{escapeHtml\(slide\.id\)\}"/);
  assert.match(player, /#bindSlideContent\(root\) \{[\s\S]*?\[data-gallery-step\], \[data-gallery-dot\][\s\S]*?\[data-slide-place\]/);
  assert.match(player, /data-stage-back hidden>← Back to the slide<\/button>/);
  assert.match(player, /if \(state\.exploring\) \{ mapController\.setViewPadding\(\{ top: 0, right: 0, bottom: 0, left: 0 \}\); return; \}/);
});

test("the data dock pages past 500, picking on the map keeps the layout still, and slides take a focus feature", () => {
  // The first page shows quickly; the rest of the layer follows in ID-ordered pages.
  assert.match(ui, /if \(Number\.isFinite\(totalCount\) && totalCount > features\.length\) void this\.#loadRemainingRecords\(layer, this\.presentationState\);/);
  assert.match(ui, /async #loadRemainingRecords\(layer, state\) \{[\s\S]*?start, num: PRESENTATION_PAGE_SIZE[\s\S]*?if \(this\.presentationState !== state/);
  // Including a feature does not open the Slide workspace (which shifted the map under the next click).
  assert.doesNotMatch(ui.match(/#toggleBriefingInclude\(result\) \{[\s\S]*?\n  \}/)[0], /state\.selected = /);
  assert.match(ui, /#syncPickBanner\(\) \{[\s\S]*?briefing-pick-banner/);
  assert.match(ui, /pickFeature: \(onPick\) => \{[\s\S]*?this\.briefingFocusPick = onPick;/);
  assert.match(slides, /#focusControl\(slide, record, main\) \{[\s\S]*?data-slide-focus-pick/);
  assert.match(slides, /on\("\[data-slide-focus-pick\]", "click", \(\) => this\.api\.pickFeature\?\.\(\(id\) => setFocus\(id\)\)\);/);
});
