import test from "node:test";
import assert from "node:assert/strict";
import { FIELD_TASK_COLUMNS, fieldTaskCsv, fieldTaskFileStem, fieldTaskPoints, fieldTaskRows } from "../js/field-task-report.js";

const task = {
  title: "Check trailhead sign",
  status: "completed",
  location: "Multnomah Falls, OR",
  latitude: 45.57617,
  longitude: -122.11576,
  address: { label: "53000 E Historic Columbia River Hwy, Bridal Veil, Oregon, 97010, USA", city: "Bridal Veil", region: "Oregon", postal: "97010", country: "United States" },
  capturedAt: "2026-10-14T16:00:00.000Z",
  notes: "Photograph the sign, then note \"damage\".",
  steps: [{ text: "Photograph sign", done: true }, { text: "=SUM(A1)", done: false }],
  features: [{ label: "Sign 12", objectId: 12, latitude: 45.5763, longitude: -122.1159, layerUrl: "https://example.test/FeatureServer/0", done: true }],
  checkIn: { latitude: 45.5764, longitude: -122.1161, accuracy: 9, at: "2026-10-14T17:55:00.000Z", address: { label: "Multnomah Falls Lodge, Bridal Veil, Oregon" } },
  report: "Sign faded,\nneeds replacing",
  completedBy: "Sam",
  completedAt: "2026-10-14T18:00:00.000Z",
  photos: ["data:image/jpeg;base64,AAAA"],
};

test("the CSV has address and time columns and a row for each part of the task", () => {
  const lines = fieldTaskCsv(task).trimEnd().split("\r\n");
  assert.equal(lines[0], FIELD_TASK_COLUMNS.join(","));
  assert.equal(lines[0], "section,item,status,latitude,longitude,address,recorded_at,object_id,layer_url,notes");
  assert.equal(lines[1], 'task,Check trailhead sign,Completed,45.57617,-122.11576,"53000 E Historic Columbia River Hwy, Bridal Veil, Oregon, 97010, USA",2026-10-14T16:00:00.000Z,,,"Photograph the sign, then note ""damage""."');
  assert.ok(lines[2].startsWith('location,"Multnomah Falls, OR",,45.57617,-122.11576,'));
  assert.ok(lines[2].endsWith('"Bridal Veil, Oregon 97010, United States"'));
  assert.equal(lines[3], 'check-in,Sam,,45.5764,-122.1161,"Multnomah Falls Lodge, Bridal Veil, Oregon",2026-10-14T17:55:00.000Z,,,accuracy 9 m');
  assert.equal(lines[4], "step,Photograph sign,done,,,,,,,");
  assert.equal(lines[5], "step,'=SUM(A1),open,,,,,,,", "formula-like text is kept as text");
  assert.equal(lines[6], "feature,Sign 12,visited,45.5763,-122.1159,,,12,https://example.test/FeatureServer/0,");
  assert.ok(lines.slice(7).join("\n").startsWith('report,Sam,completed,,,,2026-10-14T18:00:00.000Z,,,"Sign faded,'));
  assert.ok(fieldTaskCsv(task).includes("photo,Photo 1,in PDF report"));
  assert.ok(fieldTaskRows(task).every((row) => row.length === FIELD_TASK_COLUMNS.length));
});

test("file names and map points come from the task, with a pin kind for each place", () => {
  assert.equal(fieldTaskFileStem(task), "field-task-check-trailhead-sign");
  assert.equal(fieldTaskFileStem({}), "field-task-report");
  assert.deepEqual(fieldTaskPoints(task).map((point) => [point.kind, point.label]), [["task", "Multnomah Falls, OR"], ["feature", "Sign 12"], ["checkin", "Check-in"]]);
  assert.deepEqual(fieldTaskPoints({ title: "No place" }), []);
});
