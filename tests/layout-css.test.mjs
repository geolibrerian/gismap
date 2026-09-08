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
