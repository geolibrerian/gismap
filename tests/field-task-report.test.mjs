import test from "node:test";
import assert from "node:assert/strict";
import { fieldTaskCsv, fieldTaskFileStem, fieldTaskPoints } from "../js/field-task-report.js";

const task = {
  title: "Check trailhead sign",
  status: "completed",
  location: "Multnomah Falls, OR",
  latitude: 45.57617,
  longitude: -122.11576,
  notes: "Photograph the sign, then note \"damage\".",
  steps: [{ text: "Photograph sign", done: true }, { text: "=SUM(A1)", done: false }],
  features: [{ label: "Sign 12", objectId: 12, latitude: 45.5763, longitude: -122.1159, layerUrl: "https://example.test/FeatureServer/0", done: true }],
  report: "Sign faded,\nneeds replacing",
  completedBy: "Sam",
  completedAt: "2026-10-14T18:00:00.000Z",
  photos: ["data:image/jpeg;base64,AAAA"],
};

test("the CSV lists the task, its steps, features, report and photos", () => {
  const lines = fieldTaskCsv(task).trimEnd().split("\r\n");
  assert.equal(lines[0], "section,item,status,latitude,longitude,object_id,layer_url,notes");
  assert.equal(lines[1], 'task,Check trailhead sign,Completed,45.57617,-122.11576,,,"Photograph the sign, then note ""damage""."');
  assert.equal(lines[2], 'location,"Multnomah Falls, OR",,45.57617,-122.11576,,,');
  assert.equal(lines[3], "step,Photograph sign,done,,,,,");
  assert.equal(lines[4], "step,'=SUM(A1),open,,,,,", "formula-like text is kept as text");
  assert.equal(lines[5], "feature,Sign 12,visited,45.5763,-122.1159,12,https://example.test/FeatureServer/0,");
  assert.ok(lines.slice(6).join("\n").startsWith('report,Sam,2026-10-14T18:00:00.000Z,,,,,"Sign faded,'));
  assert.ok(fieldTaskCsv(task).includes("photo,Photo 1,in PDF report"));
});

test("file names and map points come from the task", () => {
  assert.equal(fieldTaskFileStem(task), "field-task-check-trailhead-sign");
  assert.equal(fieldTaskFileStem({}), "field-task-report");
  assert.deepEqual(fieldTaskPoints(task).map((point) => point.label), ["Multnomah Falls, OR", "Sign 12"]);
  assert.deepEqual(fieldTaskPoints({ title: "No place" }), []);
});
