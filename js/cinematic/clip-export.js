// Cinematic Clip video export. A Clip is rendered frame by frame from one
// timebase: frame f is the scene at f / fps seconds (observation, camera,
// caption and effect animation all derive from that time), so the movie has
// the Clip's exact length whatever the device speed. WebCodecs encodes the
// frames with explicit timestamps (Mediabunny muxes WebM or MP4). Browsers
// without WebCodecs fall back to MediaRecorder in real time, which keeps the
// length right by skipping frames it cannot draw in time, and says so.
//
// Frames are composed on a dedicated canvas (map + title, captions and
// attribution), never by recording the engine canvas, and a cross-origin
// ("tainted") map frame stops the export before anything is encoded.
import { setEffectClock } from "./effects-three.js?v=0.80.0-grow";

/** Mediabunny (MPL-2.0), pinned and loaded only when a movie is exported. */
export const MEDIABUNNY_URL = "https://cdn.jsdelivr.net/npm/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs";
export const CLIP_FRAME_RATES = Object.freeze([24, 30]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let mediabunnyLoading = null;

function loadMediabunny() {
  mediabunnyLoading ??= import(MEDIABUNNY_URL).catch((error) => {
    mediabunnyLoading = null;
    throw new Error(`The video encoder library could not be loaded (${error.message}).`);
  });
  return mediabunnyLoading;
}

/* ---------------- Timebase ---------------- */

export const clipFrameCount = (durationMs, fps) => Math.max(2, Math.round((Number(durationMs) / 1000) * Number(fps)));

function eased(t, easing) {
  const x = Math.min(1, Math.max(0, t));
  return easing === "ease-in-out" ? x * x * (3 - 2 * x) : x;
}

/** The camera at `ms`: keyframes blend with the Clip's easing, and bearing turns the short way round. */
export function cameraAt(track, ms, easing = "linear") {
  const points = (track || []).filter((point) => point?.camera).sort((a, b) => a.atMs - b.atMs);
  if (!points.length) return null;
  const right = points.find((point) => point.atMs >= ms) || points.at(-1);
  const left = [...points].reverse().find((point) => point.atMs <= ms) || points[0];
  const t = left === right ? 0 : eased((ms - left.atMs) / Math.max(1, right.atMs - left.atMs), easing);
  const lerp = (key) => left.camera[key] + (right.camera[key] - left.camera[key]) * t;
  const turn = ((((right.camera.bearing - left.camera.bearing) % 360) + 540) % 360) - 180;
  return { center: [lerp("longitude"), lerp("latitude")], zoom: lerp("zoom"), tilt: lerp("pitch"), heading: left.camera.bearing + turn * t };
}

/** Observation shown at `ms`: playback moves through observations at a steady pace, as the live timeline does. */
export function observationIndexAt(ms, durationMs, tickCount) {
  if (tickCount <= 1) return 0;
  const progress = Math.min(1, Math.max(0, ms / Math.max(1, durationMs)));
  return Math.min(tickCount - 1, Math.floor(progress * (tickCount - 1) + 1e-9));
}

export function captionAt(tracks, ms) {
  return (tracks || []).filter((track) => track.type === "caption" && track.atMs <= ms).sort((a, b) => a.atMs - b.atMs).at(-1)?.text || "";
}

/** Everything a frame shows at `ms`, deterministic for the same Clip and time. */
export function clipStateAt(clip, ms, tickCount) {
  const durationMs = Number(clip.playback?.durationMs) || 20000;
  return { ms, observationIndex: observationIndexAt(ms, durationMs, tickCount), camera: cameraAt(clip.cameraTrack, ms, clip.playback?.easing), caption: captionAt(clip.tracks, ms) };
}

/* ---------------- Formats ---------------- */

/** MediaRecorder MIME types this browser records, MP4 only where it truly records MP4 (Safari). */
export function supportedRecorderMimes(MediaRecorderClass = globalThis.MediaRecorder) {
  if (!MediaRecorderClass?.isTypeSupported) return [];
  return ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].filter((type) => MediaRecorderClass.isTypeSupported(type));
}

/** Kept for callers of the first Clip release: the best WebM the recorder supports, or null. */
export function supportedClipVideoMime(MediaRecorderClass = globalThis.MediaRecorder) {
  return supportedRecorderMimes(MediaRecorderClass).find((type) => type.startsWith("video/webm")) || null;
}

const extensionFor = (mime) => (mime.startsWith("video/mp4") ? ".mp4" : ".webm");

/**
 * The movie formats this browser can genuinely produce at this size, best
 * first: [{ id, label, container, mimeType, extension, method, codec? }].
 * WebCodecs formats are probed with the real encoder; nothing is renamed.
 */
export async function availableVideoFormats({ width = 1280, height = 720, fps = 30, loader = loadMediabunny, MediaRecorderClass = globalThis.MediaRecorder, hasWebCodecs = typeof globalThis.VideoEncoder === "function" } = {}) {
  const formats = [];
  if (hasWebCodecs) {
    try {
      const { canEncodeVideo } = await loader();
      const options = { width, height, frameRate: fps };
      for (const [container, codecs] of [["mp4", ["avc", "vp9", "av1"]], ["webm", ["vp9", "vp8", "av1"]]]) {
        for (const codec of codecs) {
          if (!await canEncodeVideo(codec, options).catch(() => false)) continue;
          formats.push({ id: `webcodecs-${container}`, method: "webcodecs", container, codec, mimeType: `video/${container}`, extension: `.${container}`, label: `${container.toUpperCase()} (${codec === "avc" ? "H.264" : codec.toUpperCase()}) · frame-accurate` });
          break;
        }
      }
    } catch { /* Fall through to the recorder: the encoder library is optional. */ }
  }
  for (const mimeType of supportedRecorderMimes(MediaRecorderClass)) {
    const container = mimeType.startsWith("video/mp4") ? "mp4" : "webm";
    if (formats.some((format) => format.container === container)) continue;
    formats.push({ id: `recorder-${container}`, method: "recorder", container, mimeType, extension: extensionFor(mimeType), label: `${container.toUpperCase()} · real-time recording (may skip frames)` });
  }
  return formats;
}

/* ---------------- Composition ---------------- */

/** Draws `source` to fill width × height, cropping the overflow evenly instead of stretching it. */
function drawCover(context, source, width, height) {
  const sourceWidth = source.naturalWidth || source.videoWidth || source.width;
  const sourceHeight = source.naturalHeight || source.videoHeight || source.height;
  if (!sourceWidth || !sourceHeight) return;
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const cropWidth = width / scale, cropHeight = height / scale;
  context.drawImage(source, (sourceWidth - cropWidth) / 2, (sourceHeight - cropHeight) / 2, cropWidth, cropHeight, 0, 0, width, height);
}

/** `text` cut with an ellipsis to fit `maxWidth` in the context's current font. */
function fitText(context, text, maxWidth) {
  const value = String(text || "");
  if (context.measureText(value).width <= maxWidth) return value;
  let low = 0, high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (context.measureText(`${value.slice(0, middle)}…`).width <= maxWidth) low = middle; else high = middle - 1;
  }
  return `${value.slice(0, low).trimEnd()}…`;
}

function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.arcTo(x + width, y, x + width, y + height, radius);
  context.arcTo(x + width, y + height, x, y + height, radius);
  context.arcTo(x, y + height, x, y, radius);
  context.arcTo(x, y, x + width, y, radius);
  context.closePath();
}

function drawSwatch(context, entry, x, y, size) {
  const fill = entry.fill || "#7a8a84";
  context.save();
  if (entry.geometry === "point") {
    const radius = Math.max(size * 0.22, Math.min(size * 0.5, entry.radius ? entry.radius * size / 14 : size * 0.32));
    context.beginPath(); context.arc(x + size / 2, y + size / 2, radius, 0, Math.PI * 2);
    context.fillStyle = fill; context.fill();
    context.lineWidth = Math.max(1, size / 12); context.strokeStyle = entry.stroke || "rgba(255,255,255,.85)"; context.stroke();
  } else if (entry.geometry === "line") {
    context.strokeStyle = fill; context.lineWidth = Math.max(2, size / 5); context.lineCap = "round";
    context.beginPath(); context.moveTo(x + 1, y + size / 2); context.lineTo(x + size - 1, y + size / 2); context.stroke();
  } else {
    roundedRect(context, x, y + size * 0.15, size, size * 0.7, size * 0.12);
    context.fillStyle = fill; context.fill();
    context.lineWidth = Math.max(1, size / 14); context.strokeStyle = entry.stroke || "rgba(255,255,255,.7)"; context.stroke();
  }
  context.restore();
}

/**
 * The frame's key, top right under the title: each Clip layer's name, field
 * and classes (as the map legend shows them), then a note that any effect is
 * decoration. Returns nothing; draws only what fits in a third of the frame.
 */
function drawLegend(context, { width, height, legend = [], effectNote = "" }) {
  const layers = legend.filter((layer) => layer?.entries?.length).slice(0, 2);
  if (!layers.length && !effectNote) return;
  const unit = height / 720;
  const pad = 14 * unit, row = 24 * unit, swatch = 14 * unit, panelWidth = Math.min(width * 0.3, 340 * unit);
  const lines = [];
  for (const layer of layers) {
    lines.push({ kind: "title", text: layer.title });
    if (layer.field) lines.push({ kind: "field", text: layer.field });
    const entries = layer.entries.slice(0, 6);
    for (const entry of entries) lines.push({ kind: "entry", entry, text: entry.label || layer.title });
    if (layer.entries.length > entries.length) lines.push({ kind: "field", text: `+ ${layer.entries.length - entries.length} more` });
  }
  if (effectNote) lines.push({ kind: "note", text: effectNote });
  const panelHeight = Math.min(height * 0.62, pad * 2 + lines.length * row);
  const x = width - panelWidth - Math.round(width * 0.02), y = Math.round(height * 0.15) + Math.round(height * 0.025);
  context.save();
  context.fillStyle = "rgba(7, 28, 24, .78)";
  roundedRect(context, x, y, panelWidth, panelHeight, 10 * unit);
  context.fill();
  let cursor = y + pad + row * 0.7;
  for (const line of lines) {
    if (cursor > y + panelHeight - pad * 0.5) break;
    const textX = line.kind === "entry" ? x + pad + swatch + 9 * unit : x + pad;
    const maxWidth = panelWidth - (textX - x) - pad;
    context.fillStyle = line.kind === "field" || line.kind === "note" ? "rgba(255, 253, 247, .72)" : "#fffdf7";
    context.font = line.kind === "title" ? `700 ${Math.round(15 * unit)}px system-ui, sans-serif`
      : line.kind === "field" ? `600 ${Math.round(11 * unit)}px system-ui, sans-serif`
      : line.kind === "note" ? `italic 400 ${Math.round(12 * unit)}px system-ui, sans-serif`
      : `400 ${Math.round(13 * unit)}px system-ui, sans-serif`;
    if (line.kind === "entry") drawSwatch(context, line.entry, x + pad, cursor - swatch * 0.85, swatch);
    context.fillText(fitText(context, line.kind === "field" ? line.text.toUpperCase() : line.text, maxWidth), textX, cursor);
    cursor += row;
  }
  context.restore();
}

/**
 * The timeline chart along the bottom of a frame: the bars up to `time` lit,
 * the rest dimmed, a playhead, the chart's label and a running `count` line.
 */
export function drawTimelineChart(context, chart, { width, height, time, count = "" } = {}) {
  if (!chart?.max || !chart.bins?.length) return;
  const x = Math.round(width * .03), y = Math.round(height * .8), w = Math.round(width * .94), h = Math.round(height * .135);
  const pad = Math.round(width * .015), barsTop = y + Math.round(h * .3), barsHeight = Math.round(h * .48), inner = w - pad * 2;
  const span = chart.end - chart.start || 1;
  const at = (value) => x + pad + Math.min(1, Math.max(0, (value - chart.start) / span)) * inner;
  context.save();
  context.fillStyle = "rgba(7, 28, 24, .78)";
  context.fillRect(x, y, w, h);
  context.font = `600 ${Math.round(height * .02)}px system-ui, sans-serif`;
  context.fillStyle = "rgba(255, 253, 247, .78)";
  context.textBaseline = "alphabetic";
  context.fillText(fitText(context, chart.label, inner * .6), x + pad, y + Math.round(h * .2));
  if (count) {
    context.fillStyle = "#fffdf7";
    context.textAlign = "right";
    context.fillText(fitText(context, count, inner * .38), x + w - pad, y + Math.round(h * .2));
    context.textAlign = "left";
  }
  const head = at(time);
  for (const bin of chart.bins) {
    if (!(bin.value > 0)) continue;
    const left = at(bin.start), barWidth = Math.max(1.5, (at(bin.end) - left) * .72);
    const barHeight = Math.max(1.5, (bin.value / chart.max) * barsHeight);
    context.fillStyle = bin.start <= time ? "#ff9a3c" : "rgba(255, 255, 255, .22)";
    context.fillRect(left, barsTop + barsHeight - barHeight, barWidth, barHeight);
  }
  context.fillStyle = "rgba(255, 255, 255, .3)";
  context.fillRect(x + pad, barsTop + barsHeight, inner, 1);
  context.fillStyle = "#fffdf7";
  context.fillRect(Math.round(head), barsTop - 2, Math.max(1, Math.round(height / 600)), barsHeight + 4);
  context.font = `400 ${Math.round(height * .016)}px system-ui, sans-serif`;
  context.fillStyle = "rgba(255, 253, 247, .7)";
  const label = (value) => chart.unit === "year" ? String(new Date(value).getUTCFullYear()) : chart.unit ? new Date(value).toISOString().slice(0, chart.unit === "month" ? 7 : 10) : Number(value).toLocaleString();
  [[0, "left"], [.5, "center"], [1, "right"]].forEach(([fraction, align]) => {
    context.textAlign = align;
    context.fillText(label(Math.min(chart.start + fraction * span, chart.bins.at(-1).start)), x + pad + fraction * inner, y + h - Math.round(h * .07));
  });
  context.restore();
}

export function drawClipComposition(context, image, { width, height, title, caption = "", attribution = true, attributionText = "", legend = [], effectNote = "", chart = null } = {}) {
  context.fillStyle = "#102d27";
  context.fillRect(0, 0, width, height);
  drawCover(context, image, width, height);
  context.fillStyle = "rgba(7, 28, 24, .84)";
  context.fillRect(0, 0, width, Math.round(height * .15));
  context.fillStyle = "#fffdf7";
  context.font = `700 ${Math.round(height * .052)}px system-ui, sans-serif`;
  context.fillText(fitText(context, String(title || "Cinematic Clip").slice(0, 100), width * .94), Math.round(width * .03), Math.round(height * .078));
  drawLegend(context, { width, height, legend, effectNote });
  if (chart) drawTimelineChart(context, chart.data, { width, height, time: chart.time, count: chart.count });
  if (caption) {
    // A timeline chart takes the bottom band, so the caption sits above it.
    const top = chart ? .69 : .82;
    context.fillStyle = "rgba(7, 28, 24, .8)";
    context.fillRect(Math.round(width * .03), Math.round(height * top), Math.round(width * .94), Math.round(height * .09));
    context.fillStyle = "#fffdf7";
    context.font = `500 ${Math.round(height * .028)}px system-ui, sans-serif`;
    context.fillText(fitText(context, String(caption).slice(0, 180), width * .9), Math.round(width * .05), Math.round(height * (top + .056)));
  }
  if (attribution) {
    context.fillStyle = "rgba(7, 28, 24, .78)";
    context.fillRect(0, height - Math.round(height * .045), width, Math.round(height * .045));
    context.fillStyle = "#fffdf7";
    context.font = `400 ${Math.round(height * .018)}px system-ui, sans-serif`;
    // Provider terms require visible credit: the line shrinks with an ellipsis, it is never dropped.
    context.fillText(fitText(context, attributionText || "Map data and imagery providers · GISMap Online", width * .96), Math.round(width * .02), height - Math.round(height * .015));
  }
}

async function imageFromDataUrl(dataUrl) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("The geographic frame could not be decoded for recording.")); image.src = dataUrl; });
  return image;
}

/**
 * A function that returns the current map frame as a drawable source once the
 * renderer has drawn the latest state. MapLibre's canvas is read directly
 * after a forced render; other engines go through captureImage().
 */
function frameReader(mapController, { width, height }) {
  const map = mapController.native?.()?.map;
  if (map?.getCanvas && map?.once && map?.triggerRepaint) {
    return async () => {
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10000);
        map.once("idle", () => { clearTimeout(timer); resolve(); });
        map.triggerRepaint();
      });
      return map.getCanvas();
    };
  }
  return async () => {
    const capture = await mapController.captureImage?.({ format: "png", width, height, aspect: width / height });
    if (!capture?.dataUrl) throw new Error("The active map renderer could not provide a capture frame.");
    return imageFromDataUrl(capture.dataUrl);
  };
}

function assertReadable(canvas) {
  // Reading pixels back throws on a tainted canvas: stop before encoding a corrupt movie.
  try { canvas.getContext("2d").getImageData(0, 0, 1, 1); }
  catch { throw new Error("Map imagery is cross-origin restricted, so this Clip cannot be exported. Use an export-enabled basemap or remove the restricted layer."); }
}

const abortError = () => Object.assign(new Error("Export cancelled."), { name: "AbortError" });

/* ---------------- Export ---------------- */

/**
 * Render a Clip to a playable movie: { blob, mimeType, extension, frames, method, droppedFrames }.
 * `controller` is the loaded cinematic controller (it supplies observations);
 * `format` is one entry of availableVideoFormats(). Cancels with `signal`.
 */
/**
 * A composition canvas and renderAt(ms), which puts the scene at `ms` on it.
 * While it is in use effects follow the scene clock; call release() after.
 */
function clipRenderer({ clip, controller, mapController, width, height, attributionText, legend = [], effectNote = "" }) {
  if (!controller?.timeline || !mapController) throw new Error("Load the Clip before exporting it.");
  const tickCount = controller.timeline.state().ticks.length;
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: false });
  const readFrame = frameReader(mapController, { width, height });
  let shown = -1;
  // Effects follow the movie's clock; offset so their noise is not at its origin.
  let sceneSeconds = 0;
  // Restored afterwards: the Cinematic master clock goes back to driving the effects.
  const previousClock = setEffectClock(() => 10 + sceneSeconds);
  // The timeline chart, unless the Clip turns it off, with the running count of the lead track.
  const chartData = clip.composition?.chart === false ? null : controller.timelineChart?.() || null;
  const chartAt = () => {
    if (!chartData) return null;
    const scene = controller.state();
    const lead = scene.layers?.find((item) => !item.ambient && item.kind !== "none");
    const noun = lead?.effect === "quake" ? "earthquakes" : "records";
    const count = lead ? `${lead.observedCount.toLocaleString()} ${noun} ${scene.spec?.cinematic.clock.timeMode === "cumulative" ? "so far" : "shown"}` : "";
    return { data: chartData, time: scene.timeline?.observationTime ?? chartData.start, count };
  };
  const renderAt = async (ms) => {
    const state = clipStateAt(clip, ms, tickCount);
    if (state.observationIndex !== shown) {
      controller.seekObservation(state.observationIndex);
      await controller.renderTask;
      shown = state.observationIndex;
    }
    if (state.camera) await mapController.setView(state.camera, { animate: false });
    sceneSeconds = ms / 1000;
    const frame = await readFrame();
    drawClipComposition(context, frame, { width, height, title: clip.title, caption: state.caption, attribution: clip.composition?.attribution !== false, attributionText, legend: clip.composition?.legend === false ? [] : legend, effectNote, chart: chartAt() });
  };
  return { canvas, renderAt, release: () => setEffectClock(previousClock) };
}

export async function exportCinematicVideo({ clip, controller, mapController, format, width = 1280, height = 720, fps = 30, attributionText = "", legend = [], effectNote = "", signal, onProgress = () => {} } = {}) {
  if (!format) throw new Error("This browser cannot produce a supported video format. Try a current Chrome, Edge, Safari or Firefox.");
  const durationMs = Math.min(120000, Math.max(1000, Number(clip.playback?.durationMs) || 20000));
  const { canvas, renderAt, release } = clipRenderer({ clip, controller, mapController, width, height, attributionText, legend, effectNote });
  try {
    // Draw the first frame before starting an encoder, so a tainted map fails fast.
    await renderAt(0);
    assertReadable(canvas);
    if (format.method === "webcodecs") return await encodeFrames({ format, canvas, fps, durationMs, renderAt, signal, onProgress });
    return await recordFrames({ format, canvas, fps, durationMs, renderAt, signal, onProgress });
  } finally {
    release();
  }
}

/** The Clip's poster: its composed frame at `clip.posterMs` (or `atMs`), as a PNG Blob. */
export async function renderClipPoster({ clip, controller, mapController, width = 1280, height = 720, attributionText = "", legend = [], effectNote = "", atMs = clip.posterMs || 0 } = {}) {
  const { canvas, renderAt, release } = clipRenderer({ clip, controller, mapController, width, height, attributionText, legend, effectNote });
  try {
    await renderAt(Math.max(0, Math.min(Number(clip.playback?.durationMs) || 0, atMs)));
    assertReadable(canvas);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("The poster could not be encoded.");
    return blob;
  } finally {
    release();
  }
}

async function encodeFrames({ format, canvas, fps, durationMs, renderAt, signal, onProgress }) {
  const { Output, BufferTarget, CanvasSource, Mp4OutputFormat, WebMOutputFormat, QUALITY_HIGH } = await loadMediabunny();
  const output = new Output({ format: format.container === "mp4" ? new Mp4OutputFormat({ fastStart: "in-memory" }) : new WebMOutputFormat(), target: new BufferTarget() });
  const source = new CanvasSource(canvas, { codec: format.codec, bitrate: QUALITY_HIGH });
  output.addVideoTrack(source, { frameRate: fps });
  const frames = clipFrameCount(durationMs, fps);
  let finished = false;
  try {
    await output.start();
    for (let index = 0; index < frames; index += 1) {
      if (signal?.aborted) throw abortError();
      if (index > 0) await renderAt((index / fps) * 1000);
      await source.add(index / fps, 1 / fps);
      onProgress(index + 1, frames);
    }
    await output.finalize();
    finished = true;
    const mimeType = output.format.mimeType;
    return { blob: new Blob([output.target.buffer], { type: mimeType }), mimeType, extension: output.format.fileExtension, frames, method: "webcodecs", droppedFrames: 0 };
  } finally {
    if (!finished) await output.cancel().catch(() => {});
  }
}

async function recordFrames({ format, canvas, fps, durationMs, renderAt, signal, onProgress }) {
  // captureStream(0) emits only on requestFrame(); without it the browser samples at fps itself.
  const manual = typeof CanvasCaptureMediaStreamTrack !== "undefined" && "requestFrame" in CanvasCaptureMediaStreamTrack.prototype;
  const stream = canvas.captureStream?.(manual ? 0 : fps);
  if (!stream) throw new Error("This browser cannot capture a composition canvas.");
  const track = stream.getVideoTracks()[0];
  let recorder;
  try { recorder = new MediaRecorder(stream, { mimeType: format.mimeType, videoBitsPerSecond: canvas.height >= 1080 ? 8_000_000 : 5_000_000 }); }
  catch { stream.getTracks().forEach((item) => item.stop()); throw new Error(`This browser reported ${format.mimeType} but could not start a recorder.`); }
  const chunks = [];
  const done = new Promise((resolve, reject) => {
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => reject(new Error("The browser stopped the video recorder."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: format.mimeType }));
  });
  const frames = clipFrameCount(durationMs, fps);
  let drawn = 0;
  try {
    recorder.start();
    const startedAt = performance.now();
    // Real time: each frame shows the scene at the wall-clock moment it is
    // drawn, so a slow frame is skipped rather than stretching the movie.
    for (;;) {
      if (signal?.aborted) throw abortError();
      const elapsed = performance.now() - startedAt;
      if (elapsed >= durationMs) break;
      const index = Math.floor((elapsed / 1000) * fps);
      if (drawn > 0) await renderAt((index / fps) * 1000);
      track.requestFrame?.();
      drawn += 1;
      onProgress(Math.min(frames, index + 1), frames);
      const next = startedAt + ((index + 1) / fps) * 1000;
      await sleep(Math.max(0, next - performance.now()));
    }
  } catch (error) {
    recorder.ondataavailable = null;
    if (recorder.state !== "inactive") recorder.stop();
    stream.getTracks().forEach((item) => item.stop());
    throw error;
  }
  if (recorder.state !== "inactive") recorder.stop();
  try {
    const blob = await done;
    return { blob, mimeType: format.mimeType, extension: format.extension, frames: drawn, method: "recorder", droppedFrames: Math.max(0, frames - drawn) };
  } finally { stream.getTracks().forEach((item) => item.stop()); }
}
