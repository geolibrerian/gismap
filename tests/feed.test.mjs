import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { filterPosts, normalizePosts, validateSmartMapUrl } from "../feed/feed-data.js";

test("Feed accepts existing public GISMap map, Brief, Tour, and example links", () => {
  const map = { version: 1, title: "Public map", layers: [{ url: "https://services.example.org/FeatureServer/0" }] };
  const result = validateSmartMapUrl(`https://gismap.online/#map=json:${encodeURIComponent(JSON.stringify(map))}`);
  assert.equal(result.post_type, "map");
  assert.equal(result.title, "Public map");
  assert.equal(validateSmartMapUrl("https://gismap.online/?briefingExample=historical-quakes").post_type, "brief");
  assert.equal(validateSmartMapUrl("https://gismap.online/?tourOnly=1#tour=json:example").post_type, "tour");
  assert.equal(validateSmartMapUrl("https://gismap.online/examples/ai/mlb-ballparks-by-state/").post_type, "map");
});

test("Feed rejects off-site, credentialed, token-bearing, and unknown links", () => {
  assert.throws(() => validateSmartMapUrl("http://gismap.online/?layer=https%3A%2F%2Fexample.org%2Fx"), /HTTPS/);
  assert.throws(() => validateSmartMapUrl("https://evil.example/#map=json:x"), /gismap.online/);
  assert.throws(() => validateSmartMapUrl("https://user:password@gismap.online/?layer=https%3A%2F%2Fexample.org%2Fx"), /username or password/);
  assert.throws(() => validateSmartMapUrl("https://gismap.online/?layer=https%3A%2F%2Fexample.org%2Fx&token=secret"), /credential parameter/);
  assert.throws(() => validateSmartMapUrl("https://gismap.online/?layer=https%3A%2F%2Fexample.org%2Fx%3Ftoken%3Dsecret"), /credential parameter/);
  assert.throws(() => validateSmartMapUrl("https://gismap.online/"), /does not look like/);
});

test("Feed normalizes responses and applies local type and text filters", () => {
  const { posts } = normalizePosts({ posts: [{ id: "1", title: "Oakland water", post_type: "map", tags: ["water"], author: null, location_label: "Oakland" }, { id: "2", title: "Tour", post_type: "tour", tags: [] }] });
  assert.equal(posts.length, 2);
  assert.equal(filterPosts(posts, { query: "oakland" }).length, 1);
  assert.equal(filterPosts(posts, { type: "tour" }).length, 1);
  assert.deepEqual(normalizePosts({ posts: [{ id: "bad", post_type: "untrusted" }] }).posts, []);
});

test("Feed remains a lightweight route and Share & export can hand off a Smart Map", async () => {
  const index = await readFile(new URL("../feed/index.html", import.meta.url), "utf8");
  const script = await readFile(new URL("../feed/feed.js", import.meta.url), "utf8");
  const css = await readFile(new URL("../feed/feed.css", import.meta.url), "utf8");
  const redirects = await readFile(new URL("../_redirects", import.meta.url), "utf8");
  const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
  assert.match(index, /feed\.js/);
  assert.doesNotMatch(index + script, /maplibre|SceneView|Cesium|three\.js/i);
  assert.match(css, /feed-bottom-nav/);
  assert.match(redirects, /\/feed\/p\/\*/);
  assert.match(ui, /Publish to GISMap Feed/);
  assert.match(ui, /\/feed\/publish\//);
  assert.match(ui, /#mapShareLink\(\)/);
});
