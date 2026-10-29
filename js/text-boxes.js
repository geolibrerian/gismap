// Map text boxes: rich, multi-run labels anchored at a [longitude, latitude, z]
// coordinate. One canvas renderer draws them live over the map and again into
// captured images, so PDFs and Smart Images show them where they sit on screen.

export const TEXT_BOX_FONTS = Object.freeze([
  { id: "sans", label: "Sans serif", css: "Inter, 'Helvetica Neue', Arial, sans-serif" },
  { id: "serif", label: "Serif", css: "Georgia, 'Times New Roman', serif" },
  { id: "mono", label: "Monospace", css: "'SFMono-Regular', Menlo, Consolas, monospace" },
  { id: "condensed", label: "Condensed", css: "'Arial Narrow', 'Roboto Condensed', sans-serif-condensed, sans-serif" },
  { id: "script", label: "Handwritten", css: "'Segoe Print', 'Bradley Hand', 'Comic Sans MS', cursive" },
]);

const MAX_BOXES = 500;
const MAX_RUNS = 40;
const HEX = /^#[0-9a-f]{6}$/i;

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};
const color = (value, fallback) => (HEX.test(String(value || "")) ? String(value).toLowerCase() : fallback);
const optionalZoom = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : clamp(value, 0, 24, null));
const fontCss = (id) => (TEXT_BOX_FONTS.find((font) => font.id === id) || TEXT_BOX_FONTS[0]).css;

export function defaultRun(overrides = {}) {
  return normalizeRun({ text: "Label", font: "sans", size: 18, bold: true, italic: false, color: "#1f2933", haloColor: "#ffffff", haloWidth: 2, ...overrides });
}

export function normalizeRun(run = {}) {
  return {
    text: String(run.text ?? "").slice(0, 2000),
    font: TEXT_BOX_FONTS.some((font) => font.id === run.font) ? run.font : "sans",
    size: clamp(run.size, 6, 144, 18),
    bold: run.bold === true,
    italic: run.italic === true,
    color: color(run.color, "#1f2933"),
    haloColor: color(run.haloColor, "#ffffff"),
    haloWidth: clamp(run.haloWidth, 0, 12, 0),
  };
}

export function normalizeTextBox(input = {}) {
  const [longitude, latitude, z] = Array.isArray(input.coordinates) ? input.coordinates : [];
  const frame = input.frame || {};
  const runs = (Array.isArray(input.runs) ? input.runs : []).slice(0, MAX_RUNS).map(normalizeRun);
  return {
    id: String(input.id || `text-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`),
    coordinates: [clamp(longitude, -180, 180, 0), clamp(latitude, -90, 90, 0), clamp(z, -12000, 1e7, 0)],
    minZoom: optionalZoom(input.minZoom),
    maxZoom: optionalZoom(input.maxZoom),
    align: ["left", "center", "right"].includes(input.align) ? input.align : "center",
    runs: runs.length ? runs : [defaultRun()],
    frame: {
      enabled: frame.enabled === true,
      fill: color(frame.fill, "#ffffff"),
      fillOpacity: clamp(frame.fillOpacity, 0, 1, 0.85),
      outline: color(frame.outline, "#1f2933"),
      outlineWidth: clamp(frame.outlineWidth, 0, 12, 1),
      padding: clamp(frame.padding, 0, 60, 8),
      radius: clamp(frame.radius, 0, 40, 4),
    },
  };
}

export function normalizeTextBoxes(list) {
  return (Array.isArray(list) ? list : []).slice(0, MAX_BOXES).map(normalizeTextBox);
}

function runFont(run, scale) {
  return `${run.italic ? "italic " : ""}${run.bold ? "700 " : "400 "}${run.size * scale}px ${fontCss(run.font)}`;
}

/** Lines of measured segments; a newline inside a run starts a new line. */
function layout(context, box, scale) {
  const lines = [{ segments: [], width: 0, height: 0, ascent: 0 }];
  for (const run of box.runs) {
    run.text.split("\n").forEach((piece, index) => {
      if (index > 0) lines.push({ segments: [], width: 0, height: 0, ascent: 0 });
      const line = lines[lines.length - 1];
      const size = run.size * scale;
      line.height = Math.max(line.height, size * 1.25);
      line.ascent = Math.max(line.ascent, size * 0.95);
      if (!piece) return;
      context.font = runFont(run, scale);
      const width = context.measureText(piece).width;
      line.segments.push({ run, text: piece, width });
      line.width += width;
    });
  }
  for (const line of lines) if (!line.height) { line.height = 18 * scale * 1.25; line.ascent = 18 * scale * 0.95; }
  const textWidth = Math.max(...lines.map((line) => line.width), 0);
  const textHeight = lines.reduce((sum, line) => sum + line.height, 0);
  const pad = box.frame.enabled ? box.frame.padding * scale : 0;
  return { lines, textWidth, textHeight, width: textWidth + pad * 2, height: textHeight + pad * 2, pad };
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

/** Draws one text box centred on (x, y). `scale` multiplies every size. Returns its bounds. */
export function drawTextBox(context, box, x, y, scale = 1) {
  const metrics = layout(context, box, scale);
  const left = x - metrics.width / 2;
  const top = y - metrics.height / 2;
  context.save();
  if (box.frame.enabled) {
    roundedRect(context, left, top, metrics.width, metrics.height, box.frame.radius * scale);
    if (box.frame.fillOpacity > 0) {
      context.globalAlpha = box.frame.fillOpacity;
      context.fillStyle = box.frame.fill;
      context.fill();
      context.globalAlpha = 1;
    }
    if (box.frame.outlineWidth > 0) {
      context.lineWidth = box.frame.outlineWidth * scale;
      context.strokeStyle = box.frame.outline;
      context.stroke();
    }
  }
  context.textBaseline = "alphabetic";
  context.lineJoin = "round";
  context.miterLimit = 2;
  let lineTop = top + metrics.pad;
  for (const line of metrics.lines) {
    let cursor = box.align === "left" ? left + metrics.pad
      : box.align === "right" ? left + metrics.pad + metrics.textWidth - line.width
        : x - line.width / 2;
    const baseline = lineTop + (line.height - line.ascent) / 2 + line.ascent * 0.92;
    for (const segment of line.segments) {
      context.font = runFont(segment.run, scale);
      if (segment.run.haloWidth > 0) {
        context.lineWidth = segment.run.haloWidth * 2 * scale;
        context.strokeStyle = segment.run.haloColor;
        context.strokeText(segment.text, cursor, baseline);
      }
      context.fillStyle = segment.run.color;
      context.fillText(segment.text, cursor, baseline);
      cursor += segment.width;
    }
    lineTop += line.height;
  }
  context.restore();
  return { left, top, width: metrics.width, height: metrics.height };
}

/**
 * Where a container pixel lands in a captured image. Both engines crop a
 * capture around the view's centre to the output's shape, then scale it.
 */
export function captureTransform(viewWidth, viewHeight, outputWidth, outputHeight) {
  const shape = outputWidth / outputHeight;
  const cropWidth = Math.min(viewWidth, viewHeight * shape);
  const cropHeight = cropWidth / shape;
  const scale = outputWidth / cropWidth;
  return { scale, offsetX: (viewWidth - cropWidth) / 2, offsetY: (viewHeight - cropHeight) / 2 };
}

/** Whether a box shows at `zoom`; an unknown zoom shows every box. */
export function visibleAtZoom(box, zoom) {
  if (!Number.isFinite(zoom)) return true;
  return (box.minZoom === null || zoom >= box.minZoom) && (box.maxZoom === null || zoom <= box.maxZoom);
}

/** Keeps the boxes, draws them over the map, and composites them into captures. */
export class TextBoxLayer {
  constructor({ project, events } = {}) {
    this.project = project; // { mapToScreen([lon, lat, z]), screenToMap(x, y), container(), zoom() }
    this.events = events;
    this.boxes = [];
    this.canvas = null;
    this.frame = 0;
    this.placing = null;
    this.selectedId = null;
  }

  list() { return structuredClone(this.boxes); }
  get(id) { const box = this.boxes.find((item) => item.id === id); return box ? structuredClone(box) : null; }
  has() { return this.boxes.length > 0; }

  set(list) {
    this.boxes = normalizeTextBoxes(list);
    this.#changed();
  }

  add(input = {}) {
    if (this.boxes.length >= MAX_BOXES) throw new Error(`A map can hold up to ${MAX_BOXES} text boxes.`);
    const box = normalizeTextBox(input);
    this.boxes.push(box);
    this.selectedId = box.id;
    this.#changed();
    return structuredClone(box);
  }

  update(id, patch = {}) {
    const index = this.boxes.findIndex((item) => item.id === id);
    if (index < 0) return null;
    const current = this.boxes[index];
    this.boxes[index] = normalizeTextBox({ ...current, ...patch, frame: { ...current.frame, ...(patch.frame || {}) }, id });
    this.#changed();
    return structuredClone(this.boxes[index]);
  }

  remove(id) {
    this.boxes = this.boxes.filter((item) => item.id !== id);
    if (this.selectedId === id) this.selectedId = null;
    this.#changed();
  }

  clear() { this.boxes = []; this.selectedId = null; this.#changed(); }

  select(id) { this.selectedId = id || null; this.render(); }

  /** Resolves with [longitude, latitude, z] at the next map click; Escape cancels with null. */
  pickCoordinate() {
    this.cancelPick();
    const canvas = this.#ensureCanvas();
    if (!canvas) return Promise.resolve(null);
    return new Promise((resolve) => {
      const finish = (value) => { this.cancelPick(); resolve(value); };
      const click = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = canvas.getBoundingClientRect();
        finish(this.project.screenToMap(event.clientX - rect.left, event.clientY - rect.top));
      };
      const key = (event) => { if (event.key === "Escape") finish(null); };
      canvas.style.pointerEvents = "auto";
      canvas.style.cursor = "crosshair";
      canvas.addEventListener("click", click);
      document.addEventListener("keydown", key);
      this.placing = () => {
        canvas.removeEventListener("click", click);
        document.removeEventListener("keydown", key);
        canvas.style.pointerEvents = "none";
        canvas.style.cursor = "";
      };
    });
  }

  cancelPick() { this.placing?.(); this.placing = null; }

  /** Re-attaches the overlay to the current map container (after an engine switch). */
  reattach() {
    this.canvas?.remove();
    this.canvas = null;
    this.#changed();
  }

  #ensureCanvas() {
    const container = this.project.container();
    if (!container || typeof document === "undefined") return null;
    if (this.canvas?.isConnected && this.canvas.parentElement === container) return this.canvas;
    this.canvas?.remove();
    const canvas = document.createElement("canvas");
    canvas.className = "text-box-overlay";
    canvas.setAttribute("aria-hidden", "true");
    Object.assign(canvas.style, { position: "absolute", inset: "0", width: "100%", height: "100%", pointerEvents: "none", zIndex: "3" });
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    container.append(canvas);
    this.canvas = canvas;
    return canvas;
  }

  #changed() {
    this.render();
    this.events?.publish?.("text-boxes:changed", { count: this.boxes.length });
    if (this.boxes.length && !this.frame) this.#loop();
  }

  // The camera can move every frame; the boxes follow while any exist.
  #loop() {
    if (typeof requestAnimationFrame !== "function") return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      if (!this.boxes.length) { this.render(); return; }
      this.render();
      this.#loop();
    });
  }

  render() {
    const canvas = this.#ensureCanvas();
    if (!canvas) return;
    const ratio = globalThis.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    const context = canvas.getContext("2d");
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    const zoom = this.project.zoom?.();
    for (const box of this.boxes) {
      if (!visibleAtZoom(box, zoom)) continue;
      const point = this.project.mapToScreen(box.coordinates);
      if (!point || point.x < -2000 || point.y < -2000 || point.x > width + 2000 || point.y > height + 2000) continue;
      const bounds = drawTextBox(context, box, point.x, point.y);
      if (box.id === this.selectedId) {
        context.save();
        context.setLineDash([4, 3]);
        context.strokeStyle = "#2f7bf6";
        context.lineWidth = 1.5;
        context.strokeRect(bounds.left - 4, bounds.top - 4, bounds.width + 8, bounds.height + 8);
        context.restore();
      }
    }
  }

  /** The capture with every visible box drawn where it sits in the view. */
  async composite(capture, format = "jpg", quality = 82) {
    if (!capture?.dataUrl || !this.boxes.length || typeof document === "undefined") return capture;
    const container = this.project.container();
    if (!container?.clientWidth || !container?.clientHeight) return capture;
    const image = new Image();
    image.src = capture.dataUrl;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = capture.width || image.naturalWidth;
    canvas.height = capture.height || image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { scale, offsetX, offsetY } = captureTransform(container.clientWidth, container.clientHeight, canvas.width, canvas.height);
    const zoom = this.project.zoom?.();
    for (const box of this.boxes) {
      if (!visibleAtZoom(box, zoom)) continue;
      const point = this.project.mapToScreen(box.coordinates);
      if (!point) continue;
      drawTextBox(context, box, (point.x - offsetX) * scale, (point.y - offsetY) * scale, scale);
    }
    const dataUrl = canvas.toDataURL(format === "png" ? "image/png" : "image/jpeg", Math.max(0, Math.min(1, quality / 100)));
    return { ...capture, dataUrl, width: canvas.width, height: canvas.height };
  }
}
