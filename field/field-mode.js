import { createFieldRecord, decodeCompactFieldRecord, encodeCompactFieldRecord, makeFieldPackage, normalizeFieldPackage, recordsGeoJSON } from "../js/field-records.js";
import { FieldRecordStore } from "../js/field-record-store.js";
import { decodeQrFromImage } from "../js/qr-import.js";

const $ = (selector) => document.querySelector(selector);
const store = new FieldRecordStore();
let records = [];
let capture = null;
let attachmentDrafts = [];
let drawing = [];
let activeStroke = null;
let installPrompt = null;

const toast = (message) => { const node = $("[data-toast]"); node.textContent = message; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.textContent = ""; }, 4200); };
const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const date = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const recordName = (record) => record.properties.title || record.properties.category || "Untitled observation";
const download = (name, value, type) => { const href = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement("a"); link.href = href; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); };
const assetId = () => `asset_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

function capabilities() {
  const entries = [
    ["Local storage", Boolean(globalThis.indexedDB)], ["GPS", Boolean(navigator.geolocation)], ["Voice", Boolean(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder)], ["Camera", "capture" in document.createElement("input")], ["Online", navigator.onLine],
  ];
  $("[data-capabilities]").innerHTML = entries.map(([label, yes]) => `<b>${escape(label)}</b> ${yes ? "ready" : "unavailable"}`).join(" · ");
}

async function refresh() {
  records = await store.listRecords();
  $("[data-record-count]").textContent = String(records.length);
  const list = $("[data-record-list]");
  list.innerHTML = records.length ? records.map((record) => `<article class="record-card"><span class="record-card__meta">${escape(record.collectionId)} · ${escape(date(record.createdAt))}${record.geometry ? " · location attached" : " · no location"}</span><h2>${escape(recordName(record))}</h2><p>${escape(record.notes.text || "No notes.")}</p><span class="record-card__meta">${record.attachments.length} attachment${record.attachments.length === 1 ? "" : "s"} · local only</span><div class="record-card__actions"><button type="button" data-show-qr="${escape(record.id)}">QR record</button><button type="button" data-delete-record="${escape(record.id)}">Delete</button></div></article>`).join("") : '<div class="field-empty"><h2>No observations yet</h2><p>Saved observations stay securely in this browser until you export them.</p></div>';
}

function switchView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === view)));
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  if (view === "records") refresh().catch((error) => toast(error.message));
}

function setLocation(location = null) {
  const form = $("[data-record-form]");
  form.elements.longitude.value = location?.coordinates?.[0] ?? "";
  form.elements.latitude.value = location?.coordinates?.[1] ?? "";
  form.dataset.locationSource = location?.source || "manual";
  form.dataset.locationAccuracy = location?.accuracyMeters ?? "";
  $("[data-location-status]").textContent = location ? `Location attached: ${location.source}${Number.isFinite(location.accuracyMeters) ? ` · ±${Math.round(location.accuracyMeters)} m` : ""}.` : "No location attached. You can save a text-only observation.";
}

async function saveAttachment(file, type) {
  const id = assetId();
  const asset = { id, type, name: file.name || `${type}-${Date.now()}`, mime: file.type || "application/octet-stream", blob: file, createdAt: new Date().toISOString() };
  await store.saveAsset(asset);
  attachmentDrafts.push({ id: `attachment_${id}`, type, localAssetId: id, name: asset.name, mime: asset.mime });
  $("[data-attachment-status]").textContent = `${attachmentDrafts.length} attachment${attachmentDrafts.length === 1 ? "" : "s"} ready to save with this observation.`;
}

function pointFromEvent(event, canvas) {
  const box = canvas.getBoundingClientRect();
  return [Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)), Math.max(0, Math.min(1, (event.clientY - box.top) / box.height))];
}
function paintSketch() {
  const canvas = $("[data-sketch]"); const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height); context.lineCap = "round"; context.lineJoin = "round"; context.strokeStyle = "#14755f"; context.lineWidth = 4;
  for (const stroke of drawing) { if (!stroke.length) continue; context.beginPath(); stroke.forEach(([x, y], index) => index ? context.lineTo(x * canvas.width, y * canvas.height) : context.moveTo(x * canvas.width, y * canvas.height)); context.stroke(); }
}
function setupSketch() {
  const canvas = $("[data-sketch]");
  canvas.addEventListener("pointerdown", (event) => { canvas.setPointerCapture(event.pointerId); activeStroke = [pointFromEvent(event, canvas)]; drawing.push(activeStroke); paintSketch(); });
  canvas.addEventListener("pointermove", (event) => { if (!activeStroke) return; activeStroke.push(pointFromEvent(event, canvas)); paintSketch(); });
  canvas.addEventListener("pointerup", () => { activeStroke = null; });
}

async function packageAssets() {
  const ids = [...new Set(records.flatMap((record) => record.attachments.map((attachment) => attachment.localAssetId)))];
  const assets = await store.getAssets(ids);
  return Promise.all(assets.map(async (asset) => ({ id: asset.id, type: asset.type, mime: asset.mime, name: asset.name, data: await blobToData(asset.blob) })));
}
async function blobToData(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}
function dataToBlob(data, mime) {
  const binary = atob(data); const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0)); return new Blob([bytes], { type: mime || "application/octet-stream" });
}

async function importPackage(file) {
  const parsed = normalizeFieldPackage(JSON.parse(await file.text()));
  const known = new Map((await store.listRecords()).map((record) => [record.id, JSON.stringify(record)]));
  let imported = 0; let skipped = 0;
  for (const record of parsed.records) {
    if (known.has(record.id)) { if (known.get(record.id) !== JSON.stringify(record)) throw new Error(`Record ${record.id} already exists with different content.`); skipped++; continue; }
    await store.saveRecord(record); known.set(record.id, JSON.stringify(record)); imported++;
  }
  for (const asset of parsed.assets) await store.saveAsset({ ...asset, blob: dataToBlob(asset.data, asset.mime), createdAt: new Date().toISOString() });
  await refresh(); toast(`Imported ${imported} observation${imported === 1 ? "" : "s"}${skipped ? `; ${skipped} already present` : ""}.`);
}

async function showQr(id) {
  const record = records.find((item) => item.id === id); if (!record) return;
  const payload = encodeCompactFieldRecord(record); const canvas = $("[data-qr-canvas]");
  if (!globalThis.QRCode?.toCanvas) throw new Error("QR generator is unavailable.");
  await globalThis.QRCode.toCanvas(canvas, payload, { width: 360, margin: 2, errorCorrectionLevel: "M", color: { dark: "#123e35", light: "#fffdf8" } });
  $("[data-qr-summary]").textContent = `${recordName(record)} · text and location only; no attachments included.`; $("[data-qr-dialog]").showModal();
}

function wire() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("[data-capture-gps]").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("GPS is unavailable in this browser."); return; }
    $("[data-location-status]").textContent = "Requesting device GPS…";
    navigator.geolocation.getCurrentPosition((position) => setLocation({ coordinates: [position.coords.longitude, position.coords.latitude], accuracyMeters: position.coords.accuracy, source: "device-gps" }), (error) => { $("[data-location-status]").textContent = "GPS was not attached."; toast(error.message || "GPS could not get a location."); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
  $("[data-clear-location]").addEventListener("click", () => setLocation());
  $("[data-clear-sketch]").addEventListener("click", () => { drawing = []; paintSketch(); });
  $("[data-record-form]").elements.photo.addEventListener("change", async (event) => { const [file] = event.target.files; if (!file) return; try { await saveAttachment(file, "photo"); } catch (error) { toast(error.message); } });
  $("[data-start-audio]").addEventListener("click", async () => {
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = []; capture = new MediaRecorder(stream); capture.ondataavailable = (event) => event.data.size && chunks.push(event.data); capture.onstop = async () => { stream.getTracks().forEach((track) => track.stop()); try { await saveAttachment(new File([new Blob(chunks, { type: capture.mimeType || "audio/webm" })], `voice-${Date.now()}.webm`, { type: capture.mimeType || "audio/webm" }), "audio"); } catch (error) { toast(error.message); } capture = null; $("[data-start-audio]").disabled = false; $("[data-stop-audio]").disabled = true; $("[data-audio-status]").textContent = "Voice recording saved locally; no transcription was created."; }; capture.start(); $("[data-start-audio]").disabled = true; $("[data-stop-audio]").disabled = false; $("[data-audio-status]").textContent = "Recording voice locally…"; } catch (error) { toast(error.message || "Microphone access was not available."); }
  });
  $("[data-stop-audio]").addEventListener("click", () => capture?.stop());
  $("[data-record-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const fields = form.elements; const longitude = Number(fields.longitude.value); const latitude = Number(fields.latitude.value);
    try {
      const hasOneCoordinate = fields.longitude.value !== "" || fields.latitude.value !== "";
      if (hasOneCoordinate && (!Number.isFinite(longitude) || !Number.isFinite(latitude))) throw new Error("Enter both longitude and latitude, or remove the incomplete location.");
      const geometry = hasOneCoordinate ? { type: "Point", coordinates: [longitude, latitude] } : null;
      const record = createFieldRecord({ collectionId: fields.collectionId.value || "default", geometry, location: geometry ? { source: form.dataset.locationSource || "manual", accuracyMeters: Number(form.dataset.locationAccuracy) || null } : { source: "none", accuracyMeters: null }, properties: { title: fields.title.value, category: fields.category.value, priority: fields.priority.value }, notes: { text: fields.notes.value, transcript: null, transcriptStatus: "pending" }, attachments: attachmentDrafts, relations: {}, ...(drawing.length ? { sketch: { coordinateSpace: "screen", strokes: drawing } } : {}) });
      await store.saveRecord(record); form.reset(); fields.collectionId.value = "default"; attachmentDrafts = []; drawing = []; paintSketch(); setLocation(); $("[data-attachment-status]").textContent = "No attachments selected."; await refresh(); toast("Observation saved on this device.");
    } catch (error) { toast(error.message); }
  });
  $("[data-record-list]").addEventListener("click", async (event) => { const target = event.target.closest("button"); if (!target) return; try { if (target.dataset.showQr) await showQr(target.dataset.showQr); if (target.dataset.deleteRecord) { const record = records.find((item) => item.id === target.dataset.deleteRecord); if (record && confirm(`Delete “${recordName(record)}” from this device?`)) { const usedElsewhere = new Set(records.filter((item) => item.id !== record.id).flatMap((item) => item.attachments.map((attachment) => attachment.localAssetId))); await store.deleteRecord(record.id); await store.deleteAssets(record.attachments.map((attachment) => attachment.localAssetId).filter((id) => !usedElsewhere.has(id))); await refresh(); toast("Observation deleted."); } } } catch (error) { toast(error.message); } });
  $("[data-export-geojson]").addEventListener("click", () => download("gismap-field-observations.geojson", JSON.stringify(recordsGeoJSON(records), null, 2), "application/geo+json"));
  $("[data-export-package]").addEventListener("click", async () => { try { const assets = await packageAssets(); download("gismap-field-observations.gisfield", JSON.stringify(makeFieldPackage(records, assets), null, 2), "application/vnd.gismap.field+json"); toast("Field package downloaded."); } catch (error) { toast(error.message); } });
  $("[data-import-package]").addEventListener("change", async (event) => { const [file] = event.target.files; if (!file) return; try { await importPackage(file); } catch (error) { toast(error.message); } event.target.value = ""; });
  $("[data-import-qr]").addEventListener("click", async () => { try { const record = decodeCompactFieldRecord($("[data-qr-text]").value.trim()); await store.saveRecord(record); await refresh(); $("[data-qr-text]").value = ""; toast("Compact QR observation imported; no attachments were included."); } catch (error) { toast(error.message); } });
  $("[data-import-qr-image]").addEventListener("change", async (event) => { const [file] = event.target.files; if (!file) return; try { const text = await decodeQrFromImage(file); if (!text) throw new Error("No QR code was found in that image."); const record = decodeCompactFieldRecord(text); await store.saveRecord(record); await refresh(); toast("QR observation imported; no attachments were included."); } catch (error) { toast(error.message); } event.target.value = ""; });
  $("[data-close-qr]").addEventListener("click", () => $("[data-qr-dialog]").close());
  window.addEventListener("online", capabilities); window.addEventListener("offline", capabilities);
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event; $("[data-install]").hidden = false; });
  $("[data-install]").addEventListener("click", async () => { if (!installPrompt) return; await installPrompt.prompt(); installPrompt = null; $("[data-install]").hidden = true; });
}

async function initialize() {
  capabilities(); setupSketch(); wire();
  try { await store.open(); await refresh(); } catch (error) { toast(error.message); }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./service-worker.js").catch(() => { /* Field Mode remains usable online without a cache. */ });
}
initialize();
