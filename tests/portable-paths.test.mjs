import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { relativeLink, relativizeHtml, rootLinksHtml } from "../scripts/relative-links.mjs";

// GISMap must work when installed in a subfolder (example.com/app/), so nothing
// links from the server root: pages link relative to themselves, the app's
// scripts resolve from js/app-root.js, and manifests relative to the manifest.
const root = new URL("../", import.meta.url);
const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
const read = (path) => readFile(new URL(path, root), "utf8");
const ROOT_ATTRIBUTE = /\b(?:href|src|action|poster)\s*=\s*\\?["']\/(?![/"'])[^"']*/g;

test("no page links from the server root", async () => {
  const offenders = [];
  for (const page of tracked.filter((path) => path.endsWith(".html") && !path.startsWith(".claude/"))) {
    for (const [match] of (await read(page)).matchAll(ROOT_ATTRIBUTE)) offenders.push(`${page}: ${match}`);
  }
  assert.deepEqual(offenders, []);
});

test("the app's scripts link to its own pages through app-root.js", async () => {
  const offenders = [];
  for (const file of tracked.filter((path) => /^js\/.*\.js$/.test(path) && !path.startsWith("js/vendor/"))) {
    const code = await read(file);
    for (const [match] of code.matchAll(ROOT_ATTRIBUTE)) offenders.push(`${file}: ${match}`);
    for (const [match] of code.matchAll(/new URL\(\s*["'`]\/(?!\/)[^"'`]*["'`]\s*,\s*(?:location|globalThis\.location)/g)) offenders.push(`${file}: ${match}`);
  }
  assert.deepEqual(offenders, []);
  assert.match(await read("js/app-root.js"), /new URL\("\.\.\/", import\.meta\.url\)/);
});

test("web app manifests use paths relative to themselves", async () => {
  for (const manifest of ["manifest.webmanifest", "field/manifest.webmanifest"]) {
    const values = JSON.stringify(JSON.parse(await read(manifest)));
    assert.doesNotMatch(values, /":"\/(?!\/)/, manifest);
  }
});

test("root links convert to page-relative links and back", () => {
  assert.equal(relativeLink("index.html", "/"), "./");
  assert.equal(relativeLink("index.html", "/examples/"), "./examples/");
  assert.equal(relativeLink("discover/examples/index.html", "/"), "../../");
  assert.equal(relativeLink("discover/examples/index.html", "/?example=a&amp;b=1#x"), "../../?example=a&amp;b=1#x");
  assert.equal(relativeLink("discover/index.html", "/discover/discovery.css"), "./discovery.css");
  const html = '<a href="/">h</a><a href="/examples/ai/">a</a><img src="/assets/x.png"><a href="https://gismap.online/x">abs</a><a href="//cdn.example/x">cdn</a>';
  for (const page of ["index.html", "examples/index.html", "discover/examples/index.html"]) assert.equal(rootLinksHtml(page, relativizeHtml(page, html)), html, page);
});
