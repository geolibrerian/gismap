// Field task reports: a branded PDF (map snapshot, steps, features, report and
// photos) and a CSV of the same record, built on the device that holds the task.
import { PDF_COLORS, PdfDocument, dataUrlBytes, imageToJpeg } from "./pdf-document.js?v=0.18.12";
import { taskSteps } from "./field-task-share.js?v=0.18.6";

const STATUS = { draft: "Draft", sent: "Sent", assigned: "To complete", "in-progress": "In progress", completed: "Completed", returned: "Report received", shared: "Shared" };
const MAX_PHOTO_SIDE = 1280;

const hasLocation = (item) => Number.isFinite(item?.latitude) && Number.isFinite(item?.longitude);
const coordinates = (item) => (hasLocation(item) ? `${Number(item.latitude).toFixed(6)}, ${Number(item.longitude).toFixed(6)}` : "");
const when = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleString() : "";
};

/** A file name stem for the task, e.g. "field-task-check-trailhead-sign". */
export function fieldTaskFileStem(task) {
  const slug = String(task?.title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "").slice(0, 48);
  return `field-task-${slug || "report"}`;
}

/** Every place the task points at: its own location first, then attached features. */
export function fieldTaskPoints(task) {
  return [
    ...(hasLocation(task) ? [{ label: task.location || task.title || "Task location", longitude: task.longitude, latitude: task.latitude }] : []),
    ...(task?.features || []).filter(hasLocation).map((feature) => ({ label: feature.label, longitude: feature.longitude, latitude: feature.latitude })),
  ];
}

// Spreadsheet apps run cells that start with = + - @ as formulas; quote them as text.
const csvCell = (value) => {
  if (value == null || value === "") return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function fieldTaskCsv(task) {
  const rows = [["section", "item", "status", "latitude", "longitude", "object_id", "layer_url", "notes"]];
  rows.push(["task", task.title || "Field task", STATUS[task.status] || task.status || "", task.latitude ?? "", task.longitude ?? "", "", "", task.notes || ""]);
  if (task.location) rows.push(["location", task.location, "", task.latitude ?? "", task.longitude ?? "", "", "", ""]);
  taskSteps(task).forEach((step) => rows.push(["step", step.text, step.done ? "done" : "open", "", "", "", "", ""]));
  (task.features || []).forEach((feature) => rows.push(["feature", feature.label, feature.done ? "visited" : "not visited", feature.latitude ?? "", feature.longitude ?? "", feature.objectId ?? "", feature.layerUrl || "", ""]));
  if (task.report || task.completedAt || task.completedBy) rows.push(["report", task.completedBy || "", task.completedAt || "", "", "", "", "", task.report || ""]);
  (task.photos || []).forEach((_, index) => rows.push(["photo", `Photo ${index + 1}`, "in PDF report", "", "", "", "", ""]));
  return `${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

/** Downscales a photo from a file input to a JPEG data URL small enough to keep with the task. */
export async function photoDataUrl(file) {
  const source = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const jpeg = await imageToJpeg(source, { maxSide: MAX_PHOTO_SIDE, quality: 0.85 });
  return jpeg?.dataUrl || source;
}

/**
 * Builds the PDF. `mapImage` is an optional { dataUrl, width, height } capture of
 * the map at the task's places.
 */
export async function fieldTaskPdf(task, { mapImage = null } = {}) {
  const logo = await imageToJpeg("./assets/gis-map-online-mark-v2.png", { width: 96, height: 96 });
  const report = new PdfDocument({ heading: "FIELD TASK REPORT", logo });
  const muted = { size: 9, leading: 14, color: PDF_COLORS.muted };
  report.addLines(task.title || "Field task", { size: 16, leading: 22, bold: true });
  const status = [STATUS[task.status] || task.status, task.completedBy && `completed by ${task.completedBy}`, when(task.completedAt)].filter(Boolean).join(" - ");
  if (status) report.addLines(status, { size: 10, leading: 15, color: PDF_COLORS.accent, bold: true });
  report.addLines(`Generated ${new Date().toLocaleString()}`, muted);

  if (task.location || hasLocation(task)) {
    report.gap(10);
    report.heading2("Location");
    if (task.location) report.addLines(task.location, { size: 11, leading: 16, bold: true });
    if (hasLocation(task)) report.addLines(`Coordinates: ${coordinates(task)}`);
  }
  if (task.notes) {
    report.gap(10);
    report.heading2("Instructions");
    report.addLines(task.notes);
  }
  const steps = taskSteps(task);
  if (steps.length) {
    report.gap(10);
    report.heading2(`Steps - ${steps.filter((step) => step.done).length} of ${steps.length} done`);
    steps.forEach((step) => report.addLines(`[${step.done ? "x" : " "}] ${step.text}`));
  }
  const features = task.features || [];
  if (features.length) {
    report.gap(10);
    report.heading2(`Features - ${features.filter((feature) => feature.done).length} of ${features.length} visited`);
    features.forEach((feature) => {
      report.addLines(`[${feature.done ? "x" : " "}] ${feature.label}`, { bold: true });
      report.addLines([feature.objectId != null && `ID ${feature.objectId}`, coordinates(feature)].filter(Boolean).join(" - "), muted);
      if (feature.layerUrl) report.addLines(feature.layerUrl, { ...muted, maxChars: 100 });
    });
  }
  if (task.report) {
    report.gap(10);
    report.heading2("Report");
    report.addLines(task.report);
  }
  if (mapImage?.dataUrl) {
    report.gap(10);
    report.heading2("Map");
    report.addLines("The task location and attached features, marked with amber pins.", muted);
    report.addImage({ bytes: dataUrlBytes(mapImage.dataUrl), width: mapImage.width, height: mapImage.height }, { maxHeight: 340 });
  }
  const photos = (await Promise.all((task.photos || []).map((photo) => imageToJpeg(photo, { maxSide: 1200, quality: 0.85 })))).filter(Boolean);
  if (photos.length) {
    report.gap(10);
    report.heading2(`Photos - ${photos.length}`);
    photos.forEach((photo, index) => {
      report.addImage(photo, { maxHeight: 300, gapAfter: 6 });
      report.addLines(`Photo ${index + 1}`, { ...muted, leading: 18 });
    });
  }
  return report.toBlob();
}
