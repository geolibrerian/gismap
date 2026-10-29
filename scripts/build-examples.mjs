import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSiteOutputs } from "./site-outputs.mjs";
import { relativizeHtml } from "./relative-links.mjs";

// Writes (or with --check, verifies) every generated file: example and guide
// pages, the sitemap, llms.txt, llms-full.txt and the api/*.json references.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const outputs = await buildSiteOutputs({ readText: (relative) => readFile(resolve(root, relative), "utf8") });
for (const [relative, generated] of outputs) {
  const target = resolve(root, relative);
  // Pages link relative to themselves, so the site works when installed in a subfolder.
  const contents = relative.endsWith(".html") ? relativizeHtml(relative, generated) : generated;
  if (check) {
    let actual;
    try { actual = await readFile(target, "utf8"); } catch { throw new Error(`Generated file is missing: ${relative}`); }
    if (actual !== contents) throw new Error(`Generated file is out of date: ${relative} (run node scripts/build-examples.mjs)`);
  } else {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
}
console.log(`${check ? "Verified" : "Generated"} ${outputs.size} files.`);
