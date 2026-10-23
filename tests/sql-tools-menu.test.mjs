import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
const ui = fs.readFileSync(new URL("../js/ui.js", import.meta.url), "utf8");

test("Tools exposes separate SQL, query, and connection entries", () => {
  assert.match(html, /data-action="tools-sql-workspace">SQL Workspace \(DuckDB-Wasm\)/);
  assert.match(html, /data-action="tools-duckdb-query">Query Data \(DuckDB\)/);
  assert.match(html, /data-action="data-duckdb">Connect DuckDB/);
  assert.match(ui, /case "tools-sql-workspace":[\s\S]*?panels\.get\("sql"\)\.mount/);
  assert.match(ui, /case "tools-duckdb-query":[\s\S]*?openDuckdbQueryWorkspace\(this, this\.applicationRuntime\.duckdb\)/);
});
