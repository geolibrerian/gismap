// Flow Map composition: one layout function turns a Flow Map model into a
// standalone SVG string. The editor preview, SVG export and PNG export all use
// this same string, so labels and values always match. Every data- or
// author-supplied string is escaped, and the SVG is built only from elements
// this module writes: no scripts, external fonts or links.

import { flowGeometry, formatCoordinate } from "./flow-map.js";

export const LAYOUT_SIZES = Object.freeze({ wide: { width: 1200, height: 675 }, square: { width: 1080, height: 1080 }, portrait: { width: 1080, height: 1350 } });

const THEME_TOKENS = {
  "editorial-light": { background: "#f6f3ec", sphere: "#eef0ee", land: "#dcd6ca", border: "#f6f3ec", text: "#23211d", muted: "#5f5a51", rule: "#d3ccbe", halo: "#f6f3ec", focus: "#1d4ed8", palette: ["#2f6db5", "#d0702d", "#3d8b57", "#8e5ac8", "#c23b5c", "#2a9aa0", "#8a6d1f", "#5b6b7a"], named: { coffee: "#7a4a2c", tea: "#3d8b57", cocoa: "#d0702d" } },
  "editorial-dark": { background: "#14181c", sphere: "#1b2126", land: "#2c333a", border: "#14181c", text: "#eceae4", muted: "#a3aab1", rule: "#39414a", halo: "#14181c", focus: "#93c5fd", palette: ["#6ea4e8", "#f0a061", "#6cc48a", "#b892ec", "#ee7a95", "#5cc8cd", "#d0b25a", "#9fb0c0"], named: { coffee: "#c9946b", tea: "#6cc48a", cocoa: "#f0a061" } },
};
const FONT = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Escape text for SVG/XML content and attribute values. */
export function escapeXml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

export function themeTokens(theme) {
  return THEME_TOKENS[theme] || THEME_TOKENS["editorial-light"];
}

/** Stable colours: well-known commodities keep their colour; others follow category rank. */
export function categoryColors(categories, theme) {
  const tokens = themeTokens(theme);
  const colors = new Map();
  let next = 0;
  for (const { name } of categories) {
    const named = tokens.named[String(name).toLowerCase()];
    colors.set(name, named || tokens.palette[next++ % tokens.palette.length]);
  }
  return colors;
}

/** Numbers for labels: grouped, one decimal below 10, compact in the millions. */
export function formatValue(value, unit = "") {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const number = abs >= 1e6
    ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
    : new Intl.NumberFormat("en-US", { maximumFractionDigits: abs < 10 ? 1 : 0 }).format(value);
  return unit ? `${number} ${unit}` : number;
}

const localDate = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

export const flowLabel = (flow) => `${flow.origin.name} → ${flow.destination.name}`;

const SCOPE_LABELS = { all: "All records", filtered: "Current filters", extent: "Map extent", selected: "Selected records" };
export const scopeLabel = (scope) => SCOPE_LABELS[scope] || "All records";

// ---------------------------------------------------------------- text layout

const charWidth = (size) => size * 0.54;
/** Greedy word wrap by an average glyph width; long words are broken. */
export function wrapText(value, width, size, maxLines = 4) {
  const limit = Math.max(4, Math.floor(width / charWidth(size)));
  const words = String(value ?? "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (let word of words) {
    while (word.length > limit) { if (line) { lines.push(line); line = ""; } lines.push(word.slice(0, limit)); word = word.slice(limit); }
    const next = line ? `${line} ${word}` : word;
    if (next.length > limit) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].replace(/.{0,1}$/, "")}…`; }
  return lines;
}

const textBlock = (lines, x, y, { size, lineHeight = size * 1.3, fill, weight = 400, anchor = "start", className = "" }) => lines.length
  ? `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${className ? ` class="${className}"` : ""}>${lines.map((line, index) => `<tspan x="${x}" dy="${index ? lineHeight : 0}">${escapeXml(line)}</tspan>`).join("")}</text>`
  : "";

const truncate = (value, width, size) => {
  const limit = Math.max(4, Math.floor(width / charWidth(size)));
  const textValue = String(value ?? "");
  return textValue.length > limit ? `${textValue.slice(0, limit - 1)}…` : textValue;
};

// ---------------------------------------------------------------- layout

function layoutBoxes(layout, headerHeight, footerHeight) {
  const { width, height } = LAYOUT_SIZES[layout] || LAYOUT_SIZES.wide;
  const pad = 40;
  if (layout === "square") {
    const mapTop = headerHeight + 8, panelTop = mapTop + 560 + 20;
    return { width, height, pad, header: { x: pad, y: pad, width: width - pad * 2 }, map: { x: 24, y: mapTop, width: width - 48, height: 560 }, legend: { x: pad, y: panelTop, width: 440 }, ranking: { x: 540, y: panelTop, width: width - 540 - pad, rows: 8 }, footer: { x: pad, y: height - footerHeight, width: width - pad * 2 } };
  }
  if (layout === "portrait") {
    // Phone order: headline, legend, map, ranking, source.
    const legendTop = headerHeight + 4, mapTop = legendTop + 92;
    return { width, height, pad, header: { x: pad, y: pad, width: width - pad * 2 }, legend: { x: pad, y: legendTop, width: width - pad * 2, inline: true }, map: { x: 24, y: mapTop, width: width - 48, height: 580 }, ranking: { x: pad, y: mapTop + 580 + 24, width: width - pad * 2, rows: 10 }, footer: { x: pad, y: height - footerHeight, width: width - pad * 2 } };
  }
  const side = 330;
  return { width, height, pad, header: { x: pad, y: pad, width: width - side - pad * 2 }, map: { x: 24, y: headerHeight + 4, width: width - side - 48, height: height - headerHeight - footerHeight - 16 }, legend: { x: width - side, y: pad, width: side - pad }, ranking: { x: width - side, y: 0, width: side - pad, rows: 10 }, footer: { x: pad, y: height - footerHeight, width: width - pad * 2 } };
}

// ---------------------------------------------------------------- geometry helpers

const round = (value) => Math.round(value * 10) / 10;
const pathData = (points) => points.length ? `M${points.map(([x, y]) => `${round(x)},${round(y)}`).join("L")}` : "";

/** Shift a screen polyline to its right-hand side, so A→B and B→A sit side by side. */
export function offsetPolyline(points, distance) {
  if (!distance || points.length < 2) return points;
  return points.map((point, index) => {
    const before = points[Math.max(0, index - 1)], after = points[Math.min(points.length - 1, index + 1)];
    const dx = after[0] - before[0], dy = after[1] - before[1];
    const length = Math.hypot(dx, dy) || 1;
    return [point[0] - (dy / length) * distance, point[1] + (dx / length) * distance];
  });
}

/** Cut the last `length` pixels off a polyline and return the arrowhead that replaces them. */
export function arrowhead(points, length, halfWidth) {
  if (points.length < 2) return { line: points, head: null };
  const tip = points[points.length - 1];
  // A head never takes more than 45% of its line, so short links (neighbours,
  // or a destination just past the seam) keep a visible shaft and direction.
  let total = 0;
  for (let i = 1; i < points.length; i += 1) total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  if (total <= 0) return { line: points, head: null };
  const ratio = Math.min(1, (total * 0.45) / length);
  length *= ratio;
  halfWidth = Math.max(1.5, halfWidth * Math.max(ratio, 0.5));
  let remaining = length;
  for (let i = points.length - 1; i > 0; i -= 1) {
    const [x1, y1] = points[i], [x0, y0] = points[i - 1];
    const segment = Math.hypot(x1 - x0, y1 - y0);
    if (segment >= remaining && segment > 0) {
      const t = remaining / segment;
      const base = [x1 - (x1 - x0) * t, y1 - (y1 - y0) * t];
      const dx = (tip[0] - base[0]) || (x1 - x0), dy = (tip[1] - base[1]) || (y1 - y0);
      const norm = Math.hypot(dx, dy) || 1;
      const nx = -dy / norm, ny = dx / norm;
      const head = [tip, [base[0] + nx * halfWidth, base[1] + ny * halfWidth], [base[0] - nx * halfWidth, base[1] - ny * halfWidth]];
      return { line: [...points.slice(0, i), base], head };
    }
    remaining -= segment;
  }
  return { line: points.slice(0, 1), head: null };
}

/** Screen-space paths for one flow. Points the projection clips are dropped. */
export function projectFlow(flow, project, { width, offset = 0 } = {}) {
  const geometry = flowGeometry(flow);
  const arrowLength = Math.max(7, width * 1.5 + 5);
  const arrowHalf = Math.max(3.5, width * 0.85 + 2.5);
  const segments = geometry.segments.map((segment, index) => {
    const screen = offsetPolyline(segment.map((point) => project(point)).filter((point) => point && Number.isFinite(point[0]) && Number.isFinite(point[1])), offset);
    if (index !== geometry.directionSegment) return { line: screen, head: null };
    return arrowhead(screen, arrowLength, arrowHalf);
  }).filter((segment) => segment.line.length >= 2 || segment.head);
  const longest = [...segments].sort((a, b) => b.line.length - a.line.length)[0];
  const middle = longest ? longest.line[Math.floor(longest.line.length / 2)] : null;
  return { segments, middle, crossesAntimeridian: geometry.crossesAntimeridian, directionSegment: segments.length - 1 };
}

// ---------------------------------------------------------------- composition

/**
 * Render a Flow Map model as a standalone SVG.
 *
 * geo.create(mapBox, flows) returns { project([lon, lat]) → [x, y] | null,
 * sphere, land, borders (SVG path data or null), credit }. The browser builds
 * it from d3-geo; tests pass a plain projection.
 */
export function renderFlowMapSvg(model, { geo, selectedKey = null, generatedAt = new Date(), animate = false } = {}) {
  const { recipe, resolved, ranking, scale, annotations, coverage } = model;
  const tokens = themeTokens(recipe.design.theme);
  const layout = recipe.design.layout;
  const { width: totalWidth } = LAYOUT_SIZES[layout] || LAYOUT_SIZES.wide;
  const headerWidth = layout === "wide" ? totalWidth - 330 - 80 : totalWidth - 80;
  const titleLines = wrapText(recipe.title || "Untitled flow map", headerWidth, layout === "wide" ? 28 : 34, 2);
  const subtitleLines = wrapText(recipe.subtitle, headerWidth, layout === "wide" ? 15 : 18, 3);
  const titleSize = layout === "wide" ? 28 : 34, subtitleSize = layout === "wide" ? 15 : 18;
  const headerHeight = 40 + titleLines.length * titleSize * 1.15 + (subtitleLines.length ? 8 + subtitleLines.length * subtitleSize * 1.35 : 0) + 8;
  const unit = resolved.unit;
  const colors = categoryColors(resolved.categories, recipe.design.theme);
  const colorOf = (flow) => colors.get(flow.category) || tokens.palette[0];

  // Footer text first: its height shapes the map box.
  const notes = annotations.filter((note) => note.status === "shown");
  const footerSize = 11.5;
  const footerWidth = totalWidth - 80;
  const sourceName = recipe.source.credit || recipe.source.name || "Source not named";
  const periodText = resolved.periods.length ? (recipe.query.aggregatePeriods ? `Periods ${resolved.periods[0]}–${resolved.periods[resolved.periods.length - 1]} aggregated` : `Period ${recipe.query.period ?? resolved.periods[0]}`) : null;
  const shareText = ranking.displayedShare === null ? "" : ` · ${Math.round(ranking.displayedShare * 100)}% of valid weight`;
  const hiddenText = ranking.hiddenCategories.length ? ` · Hidden: ${ranking.hiddenCategories.join(", ")}` : "";
  const summary = resolved.summary;
  const excludedText = summary.excludedRows ? ` · ${summary.excludedRows} row${summary.excludedRows === 1 ? "" : "s"} excluded${summary.excludedWeight > 0 ? ` (${summary.excludedWeightComplete ? "" : "at least "}${formatValue(summary.excludedWeight, unit)})` : ""}` : "";
  const footerParagraphs = [
    ...notes.map((note) => `(${note.number}) ${note.text}`),
    `Source: ${sourceName}. ${scopeLabel(recipe.query.scope.type)} · ${coverage.label || (coverage.complete === false ? "Partial" : "Complete")}${periodText ? ` · ${periodText}` : ""} · Units: ${unit}.`,
    `Showing ${ranking.displayedCount} of ${ranking.resolvedCount} flows${shareText}${hiddenText}${excludedText}. Ribbon width is proportional to weight from zero.`,
    `Connections are schematic: great-circle lines between representative points, not routes. ${[geo?.credit, model.lookupCredit].filter(Boolean).join(". ")}.`,
    `Made with GISMap Online · ${localDate(generatedAt)}`,
  ];
  const footerLines = footerParagraphs.map((paragraph) => wrapText(paragraph, footerWidth, footerSize, 3));
  const footerHeight = 24 + footerLines.reduce((total, lines) => total + lines.length, 0) * footerSize * 1.4 + 14;
  const boxes = layoutBoxes(layout, headerHeight, footerHeight);
  const { width, height } = boxes;

  // ---- map
  const map = boxes.map;
  const projected = geo?.create ? geo.create(map, ranking.displayed) : null;
  const project = projected?.project || (() => null);
  const drawOrder = [...ranking.displayed].sort((a, b) => b.weight - a.weight || (a.key < b.key ? -1 : 1));
  if (selectedKey) drawOrder.sort((a, b) => (a.key === selectedKey) - (b.key === selectedKey));
  const flowMarks = [];
  const annotationMarks = [];
  for (const flow of drawOrder) {
    const strokeWidth = Math.max(0.6, scale(flow.weight));
    const offset = flow.reverseDisplayed ? strokeWidth / 2 + 1.5 : 0;
    const shape = projectFlow(flow, project, { width: strokeWidth, offset });
    const color = colorOf(flow);
    const paths = shape.segments.map((segment) => `${segment.line.length >= 2 ? `<path d="${pathData(segment.line)}" stroke="${color}" stroke-width="${round(strokeWidth)}" fill="none" stroke-linecap="butt" stroke-linejoin="round"/>` : ""}${segment.head ? `<path class="flow__head" d="${pathData(segment.head)}Z" fill="${color}"/>` : ""}`).join("");
    const label = `${flowLabel(flow)}: ${formatValue(flow.weight, unit)}${flow.category ? `, ${flow.category}` : ""}`;
    flowMarks.push(`<g class="flow${flow.key === selectedKey ? " is-selected" : ""}" data-flow-key="${escapeXml(flow.key)}" data-category="${escapeXml(flow.category)}" style="--flow-order:${flow.rank}"><title>${escapeXml(label)}</title>${paths}</g>`);
    const note = notes.find((item) => item.anchor.key === flow.key);
    if (note && shape.middle) annotationMarks.push(`<g class="annotation" data-annotation="${escapeXml(note.id)}"><circle cx="${round(shape.middle[0])}" cy="${round(shape.middle[1])}" r="10" fill="${tokens.text}" stroke="${tokens.halo}" stroke-width="2"/><text x="${round(shape.middle[0])}" y="${round(shape.middle[1] + 4)}" font-size="12" font-weight="700" fill="${tokens.background}" text-anchor="middle">${note.number}</text></g>`);
  }

  // Endpoints: hollow origins, filled destinations; label the busiest places and the selection.
  const places = new Map();
  for (const flow of ranking.displayed) {
    for (const [end, role] of [[flow.origin, "origin"], [flow.destination, "destination"]]) {
      const place = places.get(end.id) || { ...end, total: 0, roles: new Set() };
      place.total += flow.weight;
      place.roles.add(role);
      places.set(end.id, place);
    }
  }
  const selected = ranking.displayed.find((flow) => flow.key === selectedKey) || null;
  const labelled = new Set([...places.values()].sort((a, b) => b.total - a.total || (a.id < b.id ? -1 : 1)).slice(0, layout === "wide" ? 7 : 9).map((place) => place.id));
  if (selected) { labelled.add(selected.origin.id); labelled.add(selected.destination.id); }
  const endpointMarks = [], placeLabels = [], labelBoxes = [];
  // Busiest places claim label space first; a label that would overlap one
  // already placed is left off (the place stays in the table and tooltips).
  const placeOrder = [...places.values()].sort((a, b) => (selected && [selected.origin.id, selected.destination.id].includes(b.id)) - (selected && [selected.origin.id, selected.destination.id].includes(a.id)) || b.total - a.total || (a.id < b.id ? -1 : 1));
  for (const place of placeOrder) {
    const point = project([place.lon, place.lat]);
    if (!point) continue;
    const isDestination = place.roles.has("destination");
    const isSelectedEnd = selected && (selected.origin.id === place.id || selected.destination.id === place.id);
    endpointMarks.push(`<circle class="endpoint${isSelectedEnd ? " is-selected" : ""}" cx="${round(point[0])}" cy="${round(point[1])}" r="${isSelectedEnd ? 4.5 : 3}" fill="${isDestination ? tokens.text : tokens.background}" stroke="${tokens.text}" stroke-width="1.2"/>`);
    const box = { x: point[0] + 5, y: point[1] - 18, width: place.name.length * charWidth(11.5) + 4, height: 15 };
    const fits = !labelBoxes.some((other) => box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height);
    if (labelled.has(place.id) && fits) labelBoxes.push(box);
    if (labelled.has(place.id) && fits) placeLabels.push(`<text class="place-label" x="${round(point[0] + 6)}" y="${round(point[1] - 6)}" font-size="11.5" font-weight="${isSelectedEnd ? 700 : 500}" fill="${tokens.text}" stroke="${tokens.halo}" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${escapeXml(place.name)}</text>`);
  }

  const base = projected ? [
    projected.sphere ? `<path d="${projected.sphere}" fill="${tokens.sphere}"/>` : "",
    projected.land ? `<path d="${projected.land}" fill="${tokens.land}"/>` : "",
    projected.borders ? `<path d="${projected.borders}" fill="none" stroke="${tokens.border}" stroke-width="0.6"/>` : "",
  ].join("") : `<text x="${map.x + map.width / 2}" y="${map.y + map.height / 2}" font-size="14" fill="${tokens.muted}" text-anchor="middle">Map unavailable</text>`;
  const empty = !ranking.displayed.length ? `<text x="${map.x + map.width / 2}" y="${map.y + map.height / 2}" font-size="15" fill="${tokens.muted}" text-anchor="middle">${escapeXml(resolved.blocking?.message || "No flows to draw in this scope.")}</text>` : "";

  // ---- legend
  const legend = boxes.legend;
  const legendParts = [];
  let legendY = legend.y;
  if (resolved.categories.length) {
    const visible = resolved.categories.filter((category) => !recipe.design.hiddenCategories.includes(category.name));
    if (legend.inline) {
      let x = legend.x;
      legendParts.push(`<text x="${legend.x}" y="${legendY + 12}" font-size="11" font-weight="700" fill="${tokens.muted}" letter-spacing="0.06em">CATEGORY</text>`);
      visible.forEach((category) => {
        const name = truncate(category.name, 180, 14);
        legendParts.push(`<rect x="${x}" y="${legendY + 24}" width="14" height="14" rx="3" fill="${colors.get(category.name)}"/><text x="${x + 20}" y="${legendY + 36}" font-size="14" fill="${tokens.text}">${escapeXml(name)}</text>`);
        x += 20 + name.length * charWidth(14) + 22;
      });
      legendY += 54;
    } else {
      legendParts.push(`<text x="${legend.x}" y="${legendY + 12}" font-size="11" font-weight="700" fill="${tokens.muted}" letter-spacing="0.06em">CATEGORY</text>`);
      legendY += 22;
      visible.forEach((category) => {
        legendParts.push(`<rect x="${legend.x}" y="${legendY}" width="14" height="14" rx="3" fill="${colors.get(category.name)}"/><text x="${legend.x + 22}" y="${legendY + 12}" font-size="14" fill="${tokens.text}">${escapeXml(truncate(category.name, legend.width - 120, 14))}</text><text x="${legend.x + legend.width}" y="${legendY + 12}" font-size="12.5" fill="${tokens.muted}" text-anchor="end">${escapeXml(formatValue(category.weight, unit))}</text>`);
        legendY += 22;
      });
      legendY += 10;
    }
  }
  // Width legend: the same zero-based scale the ribbons use.
  const widthLegendX = legend.inline ? legend.x + Math.min(520, legend.width / 2) : legend.x;
  let widthY = legend.inline ? legend.y : legendY;
  legendParts.push(`<text x="${widthLegendX}" y="${widthY + 12}" font-size="11" font-weight="700" fill="${tokens.muted}" letter-spacing="0.06em">WIDTH · ${escapeXml(unit.toUpperCase())}</text>`);
  widthY += 24;
  scale.legend.forEach((step, index) => {
    const x = legend.inline ? widthLegendX + index * 120 : widthLegendX;
    const y = legend.inline ? widthY + 8 : widthY + 8;
    legendParts.push(`<line x1="${x}" y1="${y}" x2="${x + 44}" y2="${y}" stroke="${tokens.muted}" stroke-width="${round(Math.max(0.6, step.width))}"/><text x="${x + 52}" y="${y + 4}" font-size="12.5" fill="${tokens.text}">${escapeXml(formatValue(step.value, unit))}</text>`);
    if (!legend.inline) widthY += Math.max(18, step.width + 8);
  });
  if (!legend.inline) legendY = widthY + 14;

  // ---- ranking
  const rankingBox = boxes.ranking;
  const rankTop = layout === "wide" ? legendY + 6 : rankingBox.y;
  const rowHeight = layout === "wide" ? 30 : 34;
  const available = layout === "wide" ? Math.floor((boxes.footer.y - 12 - rankTop - 24) / rowHeight) : rankingBox.rows;
  const rows = ranking.displayed.slice(0, Math.max(0, Math.min(rankingBox.rows, available)));
  const maxWeight = Math.max(...rows.map((flow) => flow.weight), 1);
  const rankingParts = [`<text x="${rankingBox.x}" y="${rankTop + 12}" font-size="11" font-weight="700" fill="${tokens.muted}" letter-spacing="0.06em">LARGEST FLOWS</text>`];
  rows.forEach((flow, index) => {
    const y = rankTop + 26 + index * rowHeight;
    const valueText = formatValue(flow.weight, unit);
    const labelWidth = rankingBox.width - 20 - valueText.length * charWidth(13) - 10;
    const barWidth = Math.max(1, (flow.weight / maxWeight) * (rankingBox.width - 20));
    rankingParts.push(`<g class="rank${flow.key === selectedKey ? " is-selected" : ""}" data-flow-key="${escapeXml(flow.key)}"><text x="${rankingBox.x}" y="${y + 12}" font-size="12" font-weight="700" fill="${tokens.muted}">${flow.rank}</text><text x="${rankingBox.x + 20}" y="${y + 12}" font-size="13" font-weight="${flow.key === selectedKey ? 700 : 500}" fill="${tokens.text}">${escapeXml(truncate(flowLabel(flow), labelWidth, 13))}</text><text x="${rankingBox.x + rankingBox.width}" y="${y + 12}" font-size="13" fill="${tokens.text}" text-anchor="end">${escapeXml(valueText)}</text><rect x="${rankingBox.x + 20}" y="${y + 17}" width="${round(barWidth)}" height="5" rx="1" fill="${colorOf(flow)}"/></g>`);
  });

  // ---- header and footer
  const header = boxes.header;
  const headerParts = [
    textBlock(titleLines, header.x, header.y + titleSize * 0.8, { size: titleSize, lineHeight: titleSize * 1.15, fill: tokens.text, weight: 750 }),
    textBlock(subtitleLines, header.x, header.y + titleLines.length * titleSize * 1.15 + 8 + subtitleSize * 0.6, { size: subtitleSize, lineHeight: subtitleSize * 1.35, fill: tokens.muted }),
  ];
  const footer = boxes.footer;
  let footerY = footer.y + 16;
  const footerParts = [`<line x1="${footer.x}" y1="${footer.y}" x2="${footer.x + footer.width}" y2="${footer.y}" stroke="${tokens.rule}"/>`];
  footerLines.forEach((lines, index) => {
    const isNote = index < notes.length;
    footerParts.push(textBlock(lines, footer.x, footerY + footerSize, { size: footerSize, lineHeight: footerSize * 1.4, fill: isNote ? tokens.text : tokens.muted, weight: isNote ? 600 : 400 }));
    footerY += lines.length * footerSize * 1.4;
  });

  const largest = ranking.displayed[0];
  const description = ranking.displayed.length
    ? `Flow map of ${ranking.displayedCount} of ${ranking.resolvedCount} directional flows in ${unit}. Largest: ${flowLabel(largest)}, ${formatValue(largest.weight, unit)}${largest.category ? ` (${largest.category})` : ""}. ${scopeLabel(recipe.query.scope.type)}, ${coverage.label || "Complete"}. Connections are schematic.`
    : `Flow map with no drawable flows. ${resolved.blocking?.message || ""}`.trim();
  const clipId = `flow-clip-${escapeXml(recipe.id)}`;
  const style = `.flow,.endpoint,.place-label,.rank{transition:opacity .15s}.has-selection .flow:not(.is-selected),.has-selection .rank:not(.is-selected){opacity:.2}.has-selection .endpoint:not(.is-selected){opacity:.35}${animate ? "@keyframes flow-in{from{opacity:0}to{opacity:1}}.is-playing .flow{animation:flow-in .45s ease-out both;animation-delay:calc(var(--flow-order) * 90ms)}@media (prefers-reduced-motion: reduce){.is-playing .flow{animation:none}}" : ""}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="${clipId}-title ${clipId}-desc" font-family="${escapeXml(FONT)}" class="flow-map${selectedKey ? " has-selection" : ""}"><title id="${clipId}-title">${escapeXml(recipe.title || "Flow map")}</title><desc id="${clipId}-desc">${escapeXml(description)}</desc><style>${style}</style><defs><clipPath id="${clipId}"><rect x="${map.x}" y="${map.y}" width="${map.width}" height="${map.height}"/></clipPath></defs><rect width="${width}" height="${height}" fill="${tokens.background}"/><g class="flow-map__header">${headerParts.join("")}</g><g class="flow-map__map" clip-path="url(#${clipId})">${base}<g class="flow-map__flows">${flowMarks.join("")}</g>${endpointMarks.join("")}${placeLabels.join("")}${annotationMarks.join("")}${empty}</g><g class="flow-map__legend">${legendParts.join("")}</g><g class="flow-map__ranking">${rankingParts.join("")}</g><g class="flow-map__footer">${footerParts.join("")}</g></svg>`;
  return { svg, width, height, description, mapBox: map };
}

/** The detail line for a selected flow, shared by the preview and the table. */
export function flowDetail(flow, unit) {
  if (!flow) return "";
  const at = (point) => `${point.name} (${formatCoordinate(point.lon, point.lat)})`;
  return `${at(flow.origin)} → ${at(flow.destination)} · ${formatValue(flow.weight, unit)}${flow.category ? ` · ${flow.category}` : ""}${flow.period ? ` · ${flow.period}` : ""} · ${flow.rowCount} source row${flow.rowCount === 1 ? "" : "s"}`;
}
