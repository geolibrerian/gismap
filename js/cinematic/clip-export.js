// Clip recording is deliberately composed on a dedicated canvas rather than
// recording the engine canvas. Both map renderers already expose captureImage,
// so this keeps titles, captions and attribution deterministic and gives a
// clear CORS failure when a renderer cannot supply pixels.

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Return the actual WebM MIME the browser can record, or null. Never label a WebM as MP4. */
export function supportedClipVideoMime(MediaRecorderClass = globalThis.MediaRecorder) {
  if (!MediaRecorderClass?.isTypeSupported) return null;
  return ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorderClass.isTypeSupported(type)) || null;
}

export function drawClipComposition(context, image, { width, height, title, caption = "", attribution = true } = {}) {
  context.fillStyle = "#102d27";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  context.fillStyle = "rgba(7, 28, 24, .84)";
  context.fillRect(0, 0, width, Math.round(height * .15));
  context.fillStyle = "#fffdf7";
  context.font = `700 ${Math.round(height * .052)}px system-ui, sans-serif`;
  context.fillText(String(title || "Cinematic Clip").slice(0, 100), Math.round(width * .03), Math.round(height * .078));
  if (caption) {
    context.fillStyle = "rgba(7, 28, 24, .8)";
    context.fillRect(Math.round(width * .03), Math.round(height * .82), Math.round(width * .94), Math.round(height * .09));
    context.fillStyle = "#fffdf7";
    context.font = `500 ${Math.round(height * .028)}px system-ui, sans-serif`;
    context.fillText(String(caption).slice(0, 180), Math.round(width * .05), Math.round(height * .876));
  }
  if (attribution) {
    context.fillStyle = "rgba(7, 28, 24, .78)";
    context.fillRect(0, height - Math.round(height * .045), width, Math.round(height * .045));
    context.fillStyle = "#fffdf7";
    context.font = `400 ${Math.round(height * .018)}px system-ui, sans-serif`;
    context.fillText("Map data and imagery providers · GISMap Online", Math.round(width * .02), height - Math.round(height * .015));
  }
}

async function imageFromDataUrl(dataUrl) {
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("The geographic frame could not be decoded for recording.")); image.src = dataUrl; });
  return image;
}

function cameraAt(track, elapsed) {
  const points = (track || []).filter((point) => point?.camera).sort((a, b) => a.atMs - b.atMs);
  if (!points.length) return null;
  const right = points.find((point) => point.atMs >= elapsed) || points.at(-1);
  const left = [...points].reverse().find((point) => point.atMs <= elapsed) || points[0];
  const ratio = left === right ? 0 : (elapsed - left.atMs) / Math.max(1, right.atMs - left.atMs);
  const value = (key) => left.camera[key] + (right.camera[key] - left.camera[key]) * ratio;
  return { center: [value("longitude"), value("latitude")], zoom: value("zoom"), heading: value("bearing"), tilt: value("pitch") };
}

/**
 * Render a Clip to a genuine browser-supported WebM. `controller` is the
 * existing shared cinematic controller, so this adds no second animation loop.
 */
export async function recordCinematicClip({ clip, controller, mapController, width = 1280, height = 720, onProgress = () => {} } = {}) {
  const mimeType = supportedClipVideoMime();
  if (!mimeType) throw new Error("This browser cannot record WebM video. Try a Chromium-based browser with screen/media recording enabled.");
  if (!controller?.timeline || !mapController?.captureImage) throw new Error("Load the Clip before recording it.");
  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;
  const context = canvas.getContext("2d");
  const stream = canvas.captureStream?.(30);
  if (!stream) throw new Error("This browser cannot capture a composition canvas.");
  let recorder;
  try { recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: height >= 1080 ? 7_000_000 : 4_000_000 }); }
  catch { stream.getTracks().forEach((track) => track.stop()); throw new Error(`This browser reported ${mimeType} but could not start a recorder.`); }
  const chunks = [];
  const done = new Promise((resolve, reject) => { recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); }; recorder.onerror = () => reject(new Error("The browser stopped the video recorder.")); recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType })); });
  const timeline = controller.timeline.state();
  const frames = Math.max(2, timeline.ticks.length);
  const durationMs = Math.min(30000, Math.max(10000, Number(clip.playback?.durationMs) || 20000));
  const frameMs = durationMs / frames;
  const priorView = mapController.getViewState?.();
  try {
    recorder.start();
    for (let index = 0; index < frames; index += 1) {
      controller.seekObservation(Math.min(index, timeline.ticks.length - 1));
      await controller.renderTask;
      const elapsed = Math.round((index / Math.max(1, frames - 1)) * durationMs);
      const camera = cameraAt(clip.cameraTrack, elapsed);
      if (camera) await mapController.setView(camera, { animate: false });
      const capture = await mapController.captureImage({ format: "png", width, height, aspect: width / height });
      if (!capture?.dataUrl) throw new Error("The active map renderer could not provide a capture frame.");
      const image = await imageFromDataUrl(capture.dataUrl);
      const caption = (clip.tracks || []).filter((track) => track.type === "caption" && track.atMs <= elapsed).at(-1)?.text || "";
      drawClipComposition(context, image, { width, height, title: clip.title, caption, attribution: clip.composition?.attribution !== false });
      // Calling toDataURL detects a tainted geographic frame before silently
      // producing a corrupt recording. The message names the remediation.
      try { canvas.toDataURL("image/png"); } catch { throw new Error("Map imagery is cross-origin restricted, so this Clip cannot be recorded. Use an export-enabled basemap or remove the restricted layer."); }
      stream.getVideoTracks()[0]?.requestFrame?.();
      onProgress(index + 1, frames);
      await sleep(frameMs);
    }
  } finally {
    if (recorder.state !== "inactive") recorder.stop();
    if (priorView && typeof mapController.restoreView === "function") await mapController.restoreView(priorView).catch(() => {});
  }
  try { return await done; } finally { stream.getTracks().forEach((track) => track.stop()); }
}
