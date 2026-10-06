import assert from "node:assert/strict";
import { markdownToPlainText, renderMarkdown } from "../js/markdown.js";

const html = renderMarkdown(`### Industries

**Wine** and *tourism* are prominent.

- Vineyards
- Hospitality

[Source](https://example.com/info)`);

assert.match(html, /<h4>Industries<\/h4>/);
assert.match(html, /<strong>Wine<\/strong>/);
assert.match(html, /<em>tourism<\/em>/);
assert.match(html, /<ul><li>Vineyards<\/li><li>Hospitality<\/li><\/ul>/);
assert.match(html, /href="https:\/\/example\.com\/info"/);

const tableMarkdown = `## Important attributes

| Attribute | Meaning |
| --- | --- |
| **PM2.5 value** | 4.58 µg/m³ |
| Owner | [OpenAQ](https://example.com/openaq) |`;
const tableHtml = renderMarkdown(tableMarkdown);
assert.match(tableHtml, /<table>/);
assert.match(tableHtml, /<th>Attribute<\/th>/);
assert.match(tableHtml, /<strong>PM2\.5 value<\/strong>/);
const plainTable = markdownToPlainText(tableMarkdown);
assert.doesNotMatch(plainTable, /\|/);
assert.match(plainTable, /Attribute: PM2\.5 value; Meaning: 4\.58 µg\/m³/);
assert.match(plainTable, /Owner; Meaning: OpenAQ \(https:\/\/example\.com\/openaq\)/);

const hostile = renderMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1))');
assert.doesNotMatch(hostile, /<img/i);
assert.doesNotMatch(hostile, /href=/i);
assert.match(hostile, /&lt;img/);
