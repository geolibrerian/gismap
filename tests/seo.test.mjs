import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
const robots = await readFile(new URL("../robots.txt", import.meta.url), "utf8");
const sitemap = await readFile(new URL("../sitemap.xml", import.meta.url), "utf8");

assert.match(html, /<title>GIS Map Online — Free 3D ArcGIS REST &amp; GeoJSON Viewer<\/title>/);
assert.match(html, /<link rel="canonical" href="https:\/\/gismap\.online\/" \/>/);
assert.match(html, /property="og:image"/);
assert.match(html, /name="twitter:card" content="summary_large_image"/);
assert.match(html, /<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
const structuredData = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
assert.deepEqual(structuredData["@type"], ["SoftwareApplication", "WebApplication"]);
assert.equal(structuredData.isAccessibleForFree, true);
assert.equal(structuredData.author.name, "Silas Toms");
assert.match(html, /id="welcome-title">Explore GIS data instantly/);
assert.match(html, /id="welcome-close"[^>]*aria-label="Dismiss introduction"/);
assert.doesNotMatch(ui, /welcomePanel\.hidden\s*=\s*Boolean\(layers\.length\)/);
assert.match(ui, /button\.closest\("#welcome-panel"\)/);
assert.match(robots, /Sitemap: https:\/\/gismap\.online\/sitemap\.xml/);
assert.match(sitemap, /<loc>https:\/\/gismap\.online\/<\/loc>/);
