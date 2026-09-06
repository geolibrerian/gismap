import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLE_CATEGORIES, POPULAR_SERVICES } from "../js/catalog.js";

test("catalog entries have stable, complete discovery metadata", () => {
  const ids = new Set();
  const slugs = new Set();
  const required = ["id", "slug", "provider", "title", "category", "serviceType", "description", "whyUseful", "url", "sourceOrganization", "sourcePage", "licenseOrTerms"];
  for (const item of POPULAR_SERVICES) {
    for (const field of required) assert.ok(item[field], `${item.id || "catalog entry"} is missing ${field}`);
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.match(item.slug, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(item.id), `duplicate id: ${item.id}`);
    assert.ok(!slugs.has(item.slug), `duplicate slug: ${item.slug}`);
    ids.add(item.id); slugs.add(item.slug);
    assert.ok(EXAMPLE_CATEGORIES.includes(item.category), `unknown category: ${item.category}`);
    assert.match(item.url, /^https:\/\//);
    assert.match(item.sourcePage, /^https:\/\//);
    assert.ok(Array.isArray(item.tags) && item.tags.length > 0);
    assert.ok(item.lastChecked === null || /^\d{4}-\d{2}-\d{2}$/.test(item.lastChecked));
    assert.equal(typeof item.featured, "boolean");
  }
});

test("catalog includes the documented service families", () => {
  const types = new Set(POPULAR_SERVICES.map((item) => item.serviceType));
  for (const type of ["feature", "map-image", "imagery", "geojson"]) assert.ok(types.has(type), `missing ${type}`);
  assert.ok(POPULAR_SERVICES.some((item) => item.featured), "at least one example must be featured");
});
