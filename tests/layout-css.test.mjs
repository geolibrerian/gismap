import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const css = await readFile(new URL("../css/app.css", import.meta.url), "utf8");

assert.match(css, /grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto/);
assert.match(css, /\.sidebar__scroll\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(css, /\.sidebar__scroll::-webkit-scrollbar-thumb/);
assert.match(css, /:root\[data-theme="dark"\][\s\S]*--scrollbar-thumb:/);
assert.match(css, /\.utility-content \.esri-elevation-profile/);
assert.match(css, /body:not\(\.sidebar-collapsed\) \.welcome-panel\s*\{[^}]*left:\s*calc\(var\(--sidebar\) \+ 12px\)/s);
assert.match(css, /@media \(max-width: 640px\)[\s\S]*body:not\(\.sidebar-collapsed\) \.welcome-panel\s*\{\s*display:\s*none;/);
assert.match(css, /@media \(max-width: 880px\)[\s\S]*body\.sidebar-collapsed \.app-shell\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\)/);
assert.match(css, /@media \(min-width: 641px\) and \(max-width: 880px\)[\s\S]*body\.utility-panel-open:not\(\.sidebar-collapsed\) \.sidebar/);
assert.match(css, /body\.sidebar-collapsed\.utility-panel-open \.utility-panel\s*\{[^}]*inset:\s*auto 0 0/s);
assert.match(css, /body\.mobile-map-tools-open \.map-nav\s*\{[^}]*translate\(0, -50%\)/s);
assert.match(css, /\.mobile-panel-nav\s*\{[^}]*overflow-x:\s*auto/s);
assert.match(css, /grid-template-areas:\s*"mobile-content"/);
assert.match(css, /body\.insights-open\[data-insights-position="dock-top"\] \.map-workspace/);
assert.match(css, /body\.table-open\[data-table-position="dock-top"\] \.table-dialog/);
assert.match(css, /\.insights-overlay\s*\{[^}]*top:\s*0;[^}]*width:\s*100%;[^}]*45dvh/s);
assert.match(css, /\.insight-tabs\s*\{[^}]*order:\s*2/s);
