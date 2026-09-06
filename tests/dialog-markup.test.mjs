import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");

assert.match(
  html,
  /<button class="icon-button" value="cancel" formnovalidate aria-label="Close">/,
  "The shared dialog close control must bypass validation.",
);
assert.doesNotMatch(
  ui,
  /id="server-directory-url"[^>]*\srequired(?:\s|>)/,
  "The optional GIS Server Directory field must not block dialog dismissal.",
);
