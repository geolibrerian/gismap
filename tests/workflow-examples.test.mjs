import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { WORKFLOW_EXAMPLES, workflowExampleLinks, workflowExamplePath } from "../scripts/workflow-examples.mjs";
import { decodeEmbeddedTour } from "../js/tour-share.js";
import { decodeFieldTask, readFieldTaskHash } from "../js/field-task-share.js";
// Pages link relative to themselves; these checks read them as root paths.
import { rootLinksHtml } from "../scripts/relative-links.mjs";
import { SHARE_BASEMAPS } from "../js/share.js";

const text = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8").then((text) => (path.endsWith(".html") ? rootLinksHtml(path, text) : text));
const links = await workflowExampleLinks(text);

test("each tour and field task example has its links and QR codes", async () => {
  for (const example of WORKFLOW_EXAMPLES) {
    for (const item of example.links) {
      const url = links[`${example.slug}/${item.file}`];
      assert.match(url, /^https:\/\/gismap\.online\//);
      assert.ok(url.length <= 2800, `${item.file} fits a QR code`);
      const png = await readFile(new URL(`..${workflowExamplePath(example)}${item.qr.file}`, import.meta.url));
      assert.deepEqual([...png.subarray(0, 4)], [0x89, 0x50, 0x4e, 0x47]);
    }
  }
  assert.match(await text("examples/index.html"), /id="workflows"[\s\S]*href="\/examples\/tours\/classic-ballparks\/"[\s\S]*href="\/examples\/field-tasks\/opening-day-wayfinding\/"/);
});

test("the ballpark tour has eight tilted satellite chapters, and the agent recipe's encoding reproduces it", () => {
  const url = new URL(links["classic-ballparks/link.txt"]);
  assert.equal(url.searchParams.get("tourOnly"), "1");
  const payload = url.hash.replace(/^#tour=/, "");
  const tour = decodeEmbeddedTour(payload, new Set(SHARE_BASEMAPS));
  assert.equal(tour.title, "Eight classic ballparks");
  assert.equal(tour.playbackMode, "auto");
  assert.deepEqual(tour.chapters.map((chapter) => chapter.title), ["Fenway Park", "Wrigley Field", "Dodger Stadium", "Oriole Park at Camden Yards", "Coors Field", "Oracle Park", "PNC Park", "Petco Park"]);
  for (const chapter of tour.chapters) {
    assert.equal(chapter.basemapId, "satellite");
    assert.equal(chapter.viewState.tilt, 55);
    assert.ok(chapter.body.length > 20 && chapter.body.length <= 80, chapter.title);
  }
  // The page's base64url function, applied to the same JSON, gives the same link.
  const base64url = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const json = new TextDecoder().decode(Uint8Array.from(atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (payload.length % 4)) % 4)), (char) => char.charCodeAt(0)));
  assert.equal(base64url(json), payload);
  const recipe = WORKFLOW_EXAMPLES.find((item) => item.slug === "classic-ballparks").agent.code;
  assert.match(recipe, /btoa\(String\.fromCharCode\(\.\.\.new TextEncoder\(\)\.encode\(text\)\)\)\.replace\(\/\\\+\/g, "-"\)\.replace\(\/\\\/\/g, "_"\)\.replace\(\/=\+\$\/, ""\)/);
  assert.match(recipe, /https:\/\/gismap\.online\/\?tourOnly=1#tour=/);
});

test("the field task sends two ballparks out and the report brings check-in, steps and notes back", () => {
  const assign = new URL(links["opening-day-wayfinding/assignment.txt"]);
  assert.equal(assign.searchParams.get("workflow"), "tasks");
  const { kind, task } = decodeFieldTask(readFieldTaskHash(assign.hash));
  assert.equal(kind, "assign");
  assert.equal(task.title, "Opening-day wayfinding check");
  assert.deepEqual(task.features.map((feature) => [feature.label, feature.objectId]), [["Citizens Bank Park", 3], ["PNC Park", 17]]);
  assert.ok(task.features.every((feature) => /Major_League_Baseball_Stadiums\/FeatureServer\/0$/.test(feature.layerUrl)));
  assert.equal(task.steps.length, 3);

  const report = decodeFieldTask(readFieldTaskHash(new URL(links["opening-day-wayfinding/report.txt"]).hash));
  assert.equal(report.kind, "return");
  assert.deepEqual(report.task.steps.map((step) => step.done), [true, false, true]);
  assert.ok(report.task.features.every((feature) => feature.done));
  assert.equal(report.task.checkIn.accuracy, 12);
  assert.equal(report.task.completedBy, "Field crew A");
  assert.match(report.task.report, /subway exit is faded/);
});
