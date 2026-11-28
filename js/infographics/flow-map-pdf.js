// The Flow report PDF: the infographic on its own page, then every resolved
// flow, every excluded row with its reason, and a provenance and method page,
// in the print colours of the active skin.
//
// flowReportSections is pure (tested in Node); flowReportPdf lays the
// sections out with PdfDocument and needs the graphic already as a JPEG asset.

import { PDF_COLORS, PdfDocument, pdfColor, printPalette } from "../pdf-document.js?v=0.83.0-infographics";
import { EXCLUSION_REASONS } from "./flow-map.js";
import { flowLabel, formatValue, scopeLabel } from "./flow-map-svg.js";

const LANDSCAPE = { width: 792, height: 612 };
const PORTRAIT = { width: 612, height: 792 };
const MARGIN = 40;
const percent = (value) => (value === null || value === undefined || !Number.isFinite(value) ? "-" : `${(value * 100).toFixed(value < 0.001 && value > 0 ? 2 : 1)}%`);

/** File name stem for a report. */
export const flowReportFileStem = (title) => `${String(title || "flow-map").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "flow-map"}-flow-report`;

/**
 * Everything the report states, as plain rows: the flows table (every resolved
 * flow, drawn or not), the diagnostics table and the provenance facts. Shares
 * are of all valid weight, so hidden categories and Top N never inflate them.
 */
export function flowReportSections(model, { boundaryCredit = null, generatedAt = new Date() } = {}) {
  const { recipe, resolved, ranking, coverage } = model;
  const unit = resolved.unit;
  const total = resolved.summary.validWeight;
  const drawn = new Set(ranking.displayed.map((flow) => flow.key));
  const hidden = new Set(recipe.design.hiddenCategories);
  const status = (flow) => (drawn.has(flow.key) ? "Drawn" : hidden.has(flow.category) ? "Category hidden" : "Below Top N");
  const flows = resolved.flows.map((flow, index) => [
    String(index + 1),
    flow.origin.name,
    flow.destination.name,
    flow.category || "-",
    formatValue(flow.weight),
    String(flow.rowCount),
    percent(total > 0 ? flow.weight / total : null),
    status(flow),
  ]);
  const diagnostics = resolved.diagnostics.map((row) => [
    String(row.index + 1),
    EXCLUSION_REASONS[row.reason] || row.reason,
    row.origin || "-",
    row.destination || "-",
    row.weight === null ? (row.rawWeight === null ? "missing" : `"${row.rawWeight}"`) : formatValue(row.weight),
  ]);
  const summary = resolved.summary;
  const periods = resolved.periods;
  const period = !periods.length ? "No period field" : recipe.query.aggregatePeriods ? `${periods[0]}-${periods[periods.length - 1]}, summed across ${periods.length} periods` : String(recipe.query.period ?? periods[0]);
  const bindings = recipe.bindings;
  const endpoints = bindings.mode === "coordinates"
    ? `WGS84 coordinates: origin ${bindings.origin.lonField}, ${bindings.origin.latField}; destination ${bindings.destination.lonField}, ${bindings.destination.latField}`
    : `IDs: origin ${bindings.origin.idField}, destination ${bindings.destination.idField}, resolved against ${bindings.lookup?.id || "lookup"} ${bindings.lookup?.revision || ""}`.trim();
  const facts = [
    ["Title", recipe.title || "Untitled flow map"],
    ["Source", [recipe.source.name, recipe.source.credit].filter(Boolean).join(". ") || "Not named"],
    ["Scope", `${scopeLabel(recipe.query.scope.type)} - ${coverage?.label || (coverage?.complete === false ? "Partial" : "Complete")}`],
    ["Period", period],
    ["Unit", unit],
    ["Endpoints", endpoints],
    ["Weight", `${bindings.weight.field} (${unit}), summed per origin, destination${bindings.categoryField ? ` and ${bindings.categoryField}` : ""}`],
    ["Rows read", summary.inputRows.toLocaleString("en-US")],
    ["Flows resolved", `${ranking.resolvedCount} directional flows carrying ${formatValue(total, unit)}`],
    ["Flows drawn", `${ranking.displayedCount} (Top ${recipe.design.topN})${ranking.displayedShare === null ? "" : `, ${percent(ranking.displayedShare)} of valid weight`}`],
    ["Hidden categories", ranking.hiddenCategories.length ? ranking.hiddenCategories.join(", ") : "None"],
    ["Excluded rows", summary.excludedRows ? `${summary.excludedRows}${summary.excludedWeight > 0 ? `, carrying ${summary.excludedWeightComplete ? "" : "at least "}${formatValue(summary.excludedWeight, unit)}` : ""}` : "None"],
    ["Zero-weight rows", String(summary.zeroRows)],
    ["Out-of-scope rows", String(summary.outOfScopeRows || 0)],
    ["Map", `${recipe.design.projection === "regional" ? "Mercator fitted to the drawn endpoints" : "Equal Earth world"}${boundaryCredit ? `. ${boundaryCredit}` : ""}`],
    ["Locations", model.lookupCredit || "Coordinates from the source"],
    ["Generated", generatedAt.toISOString().replace("T", " ").slice(0, 16) + " UTC"],
  ];
  const method = [
    "Rows with an empty, non-numeric or negative weight, an unmatched or ambiguous location, invalid coordinates or the same origin and destination are left out of the map and listed under Excluded rows with their reason. Zero weights are valid but draw nothing; they are counted apart.",
    "Duplicate origin-destination rows are summed within a category. A flow from A to B and one from B to A are kept apart and drawn side by side.",
    "Ribbon width is proportional to weight on a linear scale that starts at zero. The scale is set by the largest resolved flow, so hiding a category does not rescale it. Shares in this report are of all valid weight.",
    "Lines are schematic great-circle connections between representative points, not routes. They are split where they cross the 180th meridian.",
  ];
  return { flows, diagnostics, facts, method, notes: model.annotations.filter((note) => note.status !== "outside-result").map((note) => `(${note.number}) ${flowLabelForKey(resolved, note.anchor.key)}: ${note.text}`) };
}

const flowLabelForKey = (resolved, key) => {
  const flow = resolved.flows.find((item) => item.key === key);
  return flow ? `${flowLabel(flow)}${flow.category ? ` (${flow.category})` : ""}` : key;
};

/**
 * Build the PDF. `graphic` is a JPEG asset ({ bytes, width, height }) of the
 * infographic; `logo` the brand mark asset. Returns a Blob.
 */
export function flowReportPdf(model, { graphic = null, logo = null, skin = null, boundaryCredit = null, generatedAt = new Date() } = {}) {
  const sections = flowReportSections(model, { boundaryCredit, generatedAt });
  const palette = printPalette(skin);
  const title = model.recipe.title || "Flow map";
  const tall = graphic && graphic.height > graphic.width;
  const first = tall ? PORTRAIT : LANDSCAPE;
  const pdf = new PdfDocument({ heading: "FLOW REPORT", logo, palette, pageWidth: first.width, pageHeight: first.height, margin: MARGIN });
  const unit = model.resolved.unit;

  // Page 1: the graphic, as large as the page allows.
  const inner = first.width - MARGIN * 2;
  let y = pdf.addTextAt(title, { x: MARGIN, y: pdf.top + 8, width: inner, size: 15, leading: 18, bold: true, color: pdf.colors.accent });
  if (graphic) pdf.addImageAt(graphic, { x: MARGIN, y: y - 2, width: inner, height: y - 2 - 52, border: palette.frame });
  else pdf.addTextAt("The graphic could not be drawn for this PDF; the tables that follow are complete.", { x: MARGIN, y: y - 20, width: inner, size: 10, color: PDF_COLORS.muted });

  // Then landscape pages for the tables.
  const tableWidth = LANDSCAPE.width - MARGIN * 2;
  pdf.newPage({ width: LANDSCAPE.width, height: LANDSCAPE.height });
  pdf.heading2(`All resolved flows (${sections.flows.length})`);
  pdf.addLines(`Every flow the data supports, largest first, including those below Top N or in hidden categories. Weight in ${unit}; share of all valid weight.`, { size: 8.5, leading: 12, color: PDF_COLORS.muted, maxChars: 150 });
  pdf.gap(4);
  const w = (fractions) => fractions.map((fraction) => fraction * tableWidth);
  const flowWidths = w([0.05, 0.2, 0.2, 0.13, 0.12, 0.07, 0.1, 0.13]);
  if (sections.flows.length) pdf.addTable(["#", "Origin", "Destination", "Category", `Weight (${unit})`, "Rows", "Share", "On the map"].map((label, index) => ({ label, width: flowWidths[index] })), sections.flows, { size: 7.5, leading: 9.5 });
  else pdf.addLines("No flows resolved in this scope.", { size: 10 });

  pdf.gap(6);
  if (pdf.y < 140) pdf.newPage();
  pdf.heading2(`Excluded rows (${sections.diagnostics.length})`);
  if (sections.diagnostics.length) {
    pdf.addLines("Rows left out of the map, with the reason. Row numbers count from 1 in the order the source returned them.", { size: 8.5, leading: 12, color: PDF_COLORS.muted, maxChars: 150 });
    pdf.gap(4);
    const diagWidths = w([0.07, 0.43, 0.18, 0.18, 0.14]);
    pdf.addTable(["Row", "Reason", "Origin", "Destination", "Weight"].map((label, index) => ({ label, width: diagWidths[index] })), sections.diagnostics, { size: 7.5, leading: 9.5 });
  } else {
    pdf.addLines("None: every row resolved to a drawable flow.", { size: 10 });
  }

  // Provenance and method.
  pdf.newPage();
  pdf.heading2("Provenance and method");
  pdf.gap(4);
  const labelWidth = 130;
  let cursor = pdf.y;
  for (const [label, value] of sections.facts) {
    if (cursor < MARGIN + 40) { pdf.newPage(); cursor = pdf.y; }
    pdf.addTextAt(label.toUpperCase(), { x: MARGIN, y: cursor, width: labelWidth, size: 7.5, bold: true, color: PDF_COLORS.muted });
    cursor = Math.min(cursor - 12, pdf.addTextAt(value, { x: MARGIN + labelWidth, y: cursor, width: tableWidth - labelWidth, size: 9, leading: 12 })) - 1;
  }
  pdf.y = cursor - 6;
  if (sections.notes.length) {
    pdf.heading2("Notes on the graphic");
    sections.notes.forEach((note) => pdf.addLines(note, { size: 9, leading: 12, maxChars: 150 }));
    pdf.gap(4);
  }
  pdf.heading2("Method");
  sections.method.forEach((paragraph) => { pdf.addLines(paragraph, { size: 9, leading: 12, maxChars: 150 }); pdf.gap(3); });

  // Footers once the page count is known.
  const pages = pdf.pages.length;
  pdf.pages.forEach((page, index) => {
    pdf.page = page;
    const width = page.width ?? pdf.pageWidth;
    page.commands.push(`${pdfColor(palette.edge)} rg ${MARGIN} 32 ${width - MARGIN * 2} 1 re f`);
    pdf.addTextAt(`${title} - flow report - page ${index + 1} of ${pages}`, { x: MARGIN, y: 20, width: width - MARGIN * 2 - 80, size: 7.5, color: PDF_COLORS.muted, bottom: 0 });
    pdf.pageWidth = width;
    pdf.addSiteLink(20);
  });
  return pdf.toBlob();
}
