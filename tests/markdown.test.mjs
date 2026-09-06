import assert from "node:assert/strict";
import { renderMarkdown } from "../js/markdown.js";

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

const hostile = renderMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1))');
assert.doesNotMatch(hostile, /<img/i);
assert.doesNotMatch(hostile, /href=/i);
assert.match(hostile, /&lt;img/);
