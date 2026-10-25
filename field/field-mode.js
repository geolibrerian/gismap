import { createFieldRecord, decodeCompactFieldRecord, encodeCompactFieldRecord, makeFieldPackage, normalizeFieldPackage, recordsGeoJSON, reviseFieldRecord } from "../js/field-records.js";
import { FieldRecordStore } from "../js/field-record-store.js";
import { decodeQrFromImage } from "../js/qr-import.js";
import { decodeFieldTask, readFieldTaskHash, taskSteps } from "../js/field-task-share.js";
import { brandedQrFile } from "../js/pdf-document.js";
import { fieldRecordFileStem, fieldRecordPdf } from "../js/field-record-report.js";

const $ = (selector) => document.querySelector(selector);
const store = new FieldRecordStore();
let records = [];
let tasks = [];
let selectedRecordIds = new Set();
let activeQrRecord = null;
let capture = null;
let attachmentDrafts = [];
let drawing = [];
let activeStroke = null;
let installPrompt = null;
let qrCameraStream = null;
let qrCameraTimer = null;

const toast = (message) => { const node = $("[data-toast]"); node.textContent = message; clearTimeout(toast.timer); toast.timer = setTimeout(() => { node.textContent = ""; }, 4200); };
const escape = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
const date = (value) => new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
const recordName = (record) => record.properties.title || record.properties.category || "Untitled observation";
const download = (name, value, type) => { const href = URL.createObjectURL(new Blob([value], { type })); const link = document.createElement("a"); link.href = href; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(href), 1000); };
const assetId = () => `asset_${globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}`}`;

function capabilities() {
  const media = Boolean(navigator.mediaDevices?.getUserMedia && globalThis.MediaRecorder);
  const recognition = Boolean(globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition);
  const entries = [["Local storage", Boolean(globalThis.indexedDB)], ["GPS", Boolean(navigator.geolocation)], ["Audio recording", media], ["Browser speech recognition", recognition], ["Camera capture", "capture" in document.createElement("input")], ["Network", navigator.onLine]];
  const offline = navigator.onLine === false;
  $(".field-app").classList.toggle("is-offline", offline);
  $("[data-field-collection-label]").textContent = offline ? "OFFLINE COLLECTION" : "FIELD COLLECTION";
  $("[data-status-summary]").textContent = `Local workspace · ${offline ? "offline" : "online"} · ${records.length} note${records.length === 1 ? "" : "s"}`;
  $("[data-capabilities]").innerHTML = `<p><strong>Capture diagnostics</strong></p>${entries.map(([label, yes]) => `<p><b>${escape(label)}</b> ${yes ? "available" : "unavailable"}</p>`).join("")}<p>Dictation from the device keyboard is separate from browser speech recognition. GISMap records audio locally but does not claim offline transcription.</p>`;
}

async function refresh() {
  records = await store.listRecords();
  tasks = await store.listTasks();
  $("[data-record-count]").textContent = String(records.length);
  $("[data-task-count]").textContent = String(tasks.length);
  capabilities();
  const list = $("[data-record-list]");
  list.innerHTML = records.length ? `<div class="record-selection"><button type="button" data-select-all>${selectedRecordIds.size === records.length ? "Clear selection" : "Select all"}</button><span>${selectedRecordIds.size} selected</span></div>${records.map((record) => `<article class="record-card"><label class="record-card__select"><input type="checkbox" data-select-record="${escape(record.id)}" ${selectedRecordIds.has(record.id) ? "checked" : ""} /> Select for report</label><span class="record-card__meta">${escape(record.collectionId)} · observed ${escape(date(record.observedAt))}${record.geometry ? " · location attached" : " · no location"}</span><h2>${escape(recordName(record))}</h2><p>${escape(record.notes.text || "No notes.")}</p><span class="record-card__meta">Revision ${record.sync.revision} · edited ${escape(date(record.modifiedAt))} · ${record.attachments.length} attachment${record.attachments.length === 1 ? "" : "s"} · ${escape(record.sync.registeredAt ? "registered" : "local only")}</span><div class="record-card__actions"><button type="button" data-edit-record="${escape(record.id)}">Edit</button><button type="button" data-show-qr="${escape(record.id)}">Share &amp; QR</button><button type="button" data-record-pdf="${escape(record.id)}">PDF</button><button type="button" data-delete-record="${escape(record.id)}">Delete</button></div></article>`).join("")}` : '<div class="field-empty"><h2>No observations yet</h2><p>Saved observations stay securely in this browser until you export them.</p></div>';
  $("[data-task-list]").innerHTML = tasks.length ? tasks.map((task) => `<article class="record-card"><span class="record-card__meta">${escape(task.status || "in-progress")} · acknowledged locally ${escape(date(task.acknowledgedAt || task.importedAt))}</span><h2>${escape(task.title || "Untitled field task")}</h2><p>${escape(task.notes || task.location || "No instructions.")}</p><p class="record-card__meta">${taskSteps(task).filter((step) => step.done).length}/${taskSteps(task).length} steps complete${task.completedAt ? ` · completed ${escape(date(task.completedAt))}` : ""}</p><div class="task-steps">${taskSteps(task).map((step, index) => `<label><input type="checkbox" data-task-step="${escape(task.id)}" value="${index}" ${step.done ? "checked" : ""} /> ${escape(step.text)}</label>`).join("")}</div><div class="record-card__actions"><button type="button" data-note-from-task="${escape(task.id)}">Add note for task</button></div></article>`).join("") : '<div class="field-empty"><h2>No offline tasks</h2><p>Scan or paste a self-contained Field Task QR while offline to add it here.</p></div>';
}

function switchView(view) {
  document.querySelectorAll("[data-view]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.view === view)));
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  if (["records", "tasks", "transfer"].includes(view)) refresh().catch((error) => toast(error.message));
}

function setLocation(location = null) {
  const form = $("[data-record-form]");
  form.elements.longitude.value = location?.coordinates?.[0] ?? "";
  form.elements.latitude.value = location?.coordinates?.[1] ?? "";
  form.dataset.locationSource = location?.source || "manual";
  form.dataset.locationAccuracy = location?.accuracyMeters ?? "";
  form.dataset.locationAltitude = location?.altitudeMeters ?? "";
  form.dataset.locationHeading = location?.headingDegrees ?? "";
  form.dataset.locationSpeed = location?.speedMetersPerSecond ?? "";
  $("[data-location-status]").textContent = location ? `Location attached: ${location.source}${Number.isFinite(location.accuracyMeters) ? ` · ±${Math.round(location.accuracyMeters)} m` : ""}.` : "No location attached. You can save a text-only observation.";
}

async function saveAttachment(file, type) {
  const id = assetId();
  const asset = { id, type, name: file.name || `${type}-${Date.now()}`, mime: file.type || "application/octet-stream", blob: file, createdAt: new Date().toISOString() };
  await store.saveAsset(asset);
  attachmentDrafts.push({ id: `attachment_${id}`, type, localAssetId: id, name: asset.name, mime: asset.mime });
  renderDraftAttachments();
}

function renderDraftAttachments() {
  const host = $("[data-draft-attachments]");
  host.innerHTML = attachmentDrafts.length ? attachmentDrafts.map((attachment, index) => `<p class="draft-attachment">${escape(attachment.type)} · ${escape(attachment.name || "Attachment")} <button type="button" data-remove-attachment="${index}" aria-label="Remove attachment">Remove</button></p>`).join("") : '<p data-attachment-status>No attachments selected.</p>';
}

function resetEditor() {
  const form = $("[data-record-form]"); form.reset(); form.elements.collectionId.value = "default"; form.elements.recordId.value = "";
  attachmentDrafts = []; drawing = []; paintSketch(); setLocation(); renderDraftAttachments();
  delete form.dataset.taskId;
  $("[data-editor-intro]").textContent = "Works without a map or a connection. Records stay on this device until you export them.";
  $("[data-save-record]").textContent = "Save local observation"; $("[data-cancel-edit]").hidden = true;
}

function editRecord(id) {
  const record = records.find((item) => item.id === id); if (!record) return;
  const form = $("[data-record-form]"); const fields = form.elements;
  delete form.dataset.taskId;
  fields.recordId.value = record.id; fields.collectionId.value = record.collectionId; fields.title.value = record.properties.title; fields.category.value = record.properties.category; fields.priority.value = record.properties.priority; fields.notes.value = record.notes.text;
  fields.observedAt.value = record.observedAt.slice(0, 16);
  setLocation(record.geometry?.type === "Point" ? { coordinates: record.geometry.coordinates, source: record.location.source, accuracyMeters: record.location.accuracyMeters, altitudeMeters: record.location.altitudeMeters, headingDegrees: record.location.headingDegrees, speedMetersPerSecond: record.location.speedMetersPerSecond } : null);
  attachmentDrafts = structuredClone(record.attachments); drawing = structuredClone(record.sketch?.strokes || []); paintSketch(); renderDraftAttachments();
  $("[data-editor-intro]").textContent = `Editing revision ${record.sync.revision}. The original collection time and record ID will be retained.`;
  $("[data-save-record]").textContent = "Save changes"; $("[data-cancel-edit]").hidden = false; switchView("collect"); window.scrollTo({ top: 0, behavior: "smooth" });
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
  activeQrRecord = record;
  const payload = encodeCompactFieldRecord(record); const canvas = $("[data-qr-canvas]");
  if (!globalThis.QRCode?.toCanvas) throw new Error("QR generator is unavailable.");
  await globalThis.QRCode.toCanvas(canvas, payload, { width: 360, margin: 2, errorCorrectionLevel: "M", color: { dark: "#123e35", light: "#fffdf8" } });
  $("[data-qr-summary]").textContent = `${recordName(record)} · text and location only; no attachments included.`; $("[data-qr-dialog]").showModal();
}

async function qrCard(record) {
  const payload = encodeCompactFieldRecord(record);
  const file = await brandedQrFile(payload, { fileName: `${fieldRecordFileStem(record)}-qr.png`, title: recordName(record), lines: ["Portable Field Mode record", "Attachments stay in the .gisfield package."], footer: "Scan in GISMap Field Mode" });
  if (!file) throw new Error("QR card generation is unavailable.");
  return file;
}

async function reportFile(forRecords) {
  if (!forRecords.length) throw new Error("Select at least one note for a report.");
  const assets = await store.getAssets([...new Set(forRecords.flatMap((record) => record.attachments.map((attachment) => attachment.localAssetId)))]);
  const blob = await fieldRecordPdf(forRecords, { assets, qrForRecord: encodeCompactFieldRecord, skin: "gismap", baseUrl: location.origin });
  return new File([blob], `${forRecords.length === 1 ? fieldRecordFileStem(forRecords[0]) : "field-report"}.pdf`, { type: "application/pdf" });
}

async function mobileShare({ title, text, file = null } = {}) {
  const data = file && navigator.canShare?.({ files: [file] }) ? { title, text, files: [file] } : { title, text };
  if (navigator.share) { await navigator.share(data); return; }
  if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text || title); toast("Share text copied."); return; }
  throw new Error("Sharing is unavailable in this browser. Download the file instead.");
}

function selectedRecords() {
  return records.filter((record) => selectedRecordIds.has(record.id));
}

async function importQrText(text) {
  const value = String(text || "").trim();
  if (value.startsWith("gismap-field:v1:")) {
    const record = decodeCompactFieldRecord(value); const existing = records.find((item) => item.id === record.id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(record)) throw new Error("This note already exists with a different revision. Import a .gisfield package to review both copies.");
    if (!existing) await store.saveRecord(record); await refresh(); toast(existing ? "This note is already on this device." : "Compact note imported; attachments are not included."); return;
  }
  let hash = value;
  try { hash = new URL(value).hash; } catch { /* A bare field-task fragment is also accepted. */ }
  const encoded = readFieldTaskHash(hash);
  if (!encoded) throw new Error("This is not a supported Field Mode note or Field Task QR.");
  const shared = decodeFieldTask(encoded, { allowHttp: location.hostname === "localhost" });
  const task = shared.task; const existing = tasks.find((item) => item.id === task.id);
  if (!existing) await store.saveTask({ ...task, id: task.id || `task_${Date.now()}`, status: task.status === "completed" ? "completed" : "in-progress", importedAt: new Date().toISOString(), acknowledgedAt: new Date().toISOString(), source: "offline-qr", revision: 1 });
  await refresh(); switchView("tasks"); toast(existing ? "This task is already on this device." : "Field Task added and acknowledged locally. It has not been registered with a server.");
}

function stopQrCamera() {
  if (qrCameraTimer) clearTimeout(qrCameraTimer);
  qrCameraTimer = null;
  qrCameraStream?.getTracks().forEach((track) => track.stop());
  qrCameraStream = null;
  const video = $("[data-qr-scanner-video]");
  if (video) video.srcObject = null;
}

async function scanQrWithCamera() {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera scanning is unavailable here. Use Take QR photo instead.");
  if (typeof globalThis.BarcodeDetector !== "function") throw new Error("Live QR scanning is unavailable in this browser. Use Take QR photo instead.");
  const dialog = $("[data-qr-scanner-dialog]"); const video = $("[data-qr-scanner-video]"); const status = $("[data-qr-scanner-status]");
  stopQrCamera();
  try {
    const formats = await globalThis.BarcodeDetector.getSupportedFormats?.();
    if (formats && !formats.includes("qr_code")) throw new Error("This camera does not support QR scanning. Use Take QR photo instead.");
    const detector = new globalThis.BarcodeDetector({ formats: ["qr_code"] });
    qrCameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    video.srcObject = qrCameraStream;
    if (!dialog.open) dialog.showModal();
    await video.play(); status.textContent = "Point the camera at a Field Mode or Field Task QR code.";
    const detect = async () => {
      if (!qrCameraStream) return;
      try {
        const codes = video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? await detector.detect(video) : [];
        const value = codes.find((code) => code.rawValue)?.rawValue;
        if (value) {
          stopQrCamera(); dialog.close(); await importQrText(value); return;
        }
      } catch (error) { status.textContent = error.message || "Camera scan failed. Use Take QR photo instead."; stopQrCamera(); return; }
      qrCameraTimer = setTimeout(detect, 250);
    };
    void detect();
  } catch (error) {
    stopQrCamera();
    if (dialog.open) dialog.close();
    throw error;
  }
}

async function importQrImage(file) {
  if (!file) return;
  const text = await decodeQrFromImage(file);
  if (!text) throw new Error("No QR code was found in that image.");
  await importQrText(text);
}

function wire() {
  document.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
  $("[data-capture-gps]").addEventListener("click", () => {
    if (!navigator.geolocation) { toast("GPS is unavailable in this browser."); return; }
    $("[data-location-status]").textContent = "Requesting device GPS…";
    navigator.geolocation.getCurrentPosition((position) => setLocation({ coordinates: [position.coords.longitude, position.coords.latitude], accuracyMeters: position.coords.accuracy, altitudeMeters: position.coords.altitude, headingDegrees: position.coords.heading, speedMetersPerSecond: position.coords.speed, source: "device-gps" }), (error) => { $("[data-location-status]").textContent = "GPS was not attached."; toast(error.message || "GPS could not get a location."); }, { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 });
  });
  $("[data-clear-location]").addEventListener("click", () => setLocation());
  $("[data-clear-sketch]").addEventListener("click", () => { drawing = []; paintSketch(); });
  ["photo", "cameraPhoto"].forEach((name) => $("[data-record-form]").elements[name].addEventListener("change", async (event) => { const [file] = event.target.files; if (!file) return; try { await saveAttachment(file, "photo"); } catch (error) { toast(error.message); } event.target.value = ""; }));
  $("[data-toggle-audio]").addEventListener("click", async (event) => {
    if (capture) { capture.stop(); return; }
    try { const stream = await navigator.mediaDevices.getUserMedia({ audio: true }); const chunks = []; capture = new MediaRecorder(stream); capture.ondataavailable = (item) => item.data.size && chunks.push(item.data); capture.onstop = async () => { const mime = capture?.mimeType || "audio/webm"; stream.getTracks().forEach((track) => track.stop()); try { await saveAttachment(new File([new Blob(chunks, { type: mime })], `voice-${Date.now()}.webm`, { type: mime }), "audio"); } catch (error) { toast(error.message); } capture = null; event.currentTarget.textContent = "Record voice"; $("[data-audio-status]").textContent = "Voice recording saved locally; no transcription was created."; }; capture.start(); event.currentTarget.textContent = "Stop recording"; $("[data-audio-status]").textContent = "Recording voice locally…"; } catch (error) { $("[data-audio-status]").textContent = `Audio recording unavailable: ${error.message || "permission was denied"}. Device keyboard dictation may still work in Notes.`; }
  });
  $("[data-record-form]").addEventListener("submit", async (event) => {
    event.preventDefault(); const form = event.currentTarget; const fields = form.elements; const longitude = Number(fields.longitude.value); const latitude = Number(fields.latitude.value);
    try {
      const hasOneCoordinate = fields.longitude.value !== "" || fields.latitude.value !== "";
      if (hasOneCoordinate && (!Number.isFinite(longitude) || !Number.isFinite(latitude))) throw new Error("Enter both longitude and latitude, or remove the incomplete location.");
      const geometry = hasOneCoordinate ? { type: "Point", coordinates: [longitude, latitude] } : null;
      const existing = fields.recordId.value && records.find((item) => item.id === fields.recordId.value);
      const observedAt = fields.observedAt.value ? new Date(fields.observedAt.value).toISOString() : (existing?.observedAt || undefined);
      const values = { collectionId: fields.collectionId.value || "default", observedAt, geometry, location: geometry ? { source: form.dataset.locationSource || "manual", accuracyMeters: Number(form.dataset.locationAccuracy) || null, altitudeMeters: Number(form.dataset.locationAltitude) || null, headingDegrees: Number(form.dataset.locationHeading) || null, speedMetersPerSecond: Number(form.dataset.locationSpeed) || null } : { source: "none", accuracyMeters: null }, properties: { title: fields.title.value, category: fields.category.value, priority: fields.priority.value }, notes: { text: fields.notes.value, transcript: null, transcriptStatus: "pending" }, attachments: attachmentDrafts, relations: { fieldTaskIds: form.dataset.taskId ? [form.dataset.taskId] : (existing?.relations?.fieldTaskIds || []), mapNoteIds: existing?.relations?.mapNoteIds || [] }, ...(drawing.length ? { sketch: { coordinateSpace: "screen", strokes: drawing } } : {}) };
      const record = existing ? reviseFieldRecord(existing, values) : createFieldRecord(values);
      await store.saveRecord(record); resetEditor(); await refresh(); toast(existing ? `Changes saved locally as revision ${record.sync.revision}.` : "Observation saved on this device.");
    } catch (error) { toast(error.message); }
  });
  $("[data-cancel-edit]").addEventListener("click", resetEditor);
  $("[data-draft-attachments]").addEventListener("click", (event) => { const target = event.target.closest("button[data-remove-attachment]"); if (!target) return; attachmentDrafts.splice(Number(target.dataset.removeAttachment), 1); renderDraftAttachments(); });
  $("[data-record-list]").addEventListener("change", (event) => { const input = event.target; if (!input.matches("[data-select-record]")) return; if (input.checked) selectedRecordIds.add(input.dataset.selectRecord); else selectedRecordIds.delete(input.dataset.selectRecord); refresh().catch((error) => toast(error.message)); });
  $("[data-record-list]").addEventListener("click", async (event) => { const target = event.target.closest("button"); if (!target) return; try { if (target.dataset.selectAll !== undefined) { selectedRecordIds = selectedRecordIds.size === records.length ? new Set() : new Set(records.map((record) => record.id)); await refresh(); return; } if (target.dataset.editRecord) { editRecord(target.dataset.editRecord); return; } if (target.dataset.showQr) await showQr(target.dataset.showQr); if (target.dataset.recordPdf) { const record = records.find((item) => item.id === target.dataset.recordPdf); download(`${fieldRecordFileStem(record)}.pdf`, await reportFile([record]), "application/pdf"); } if (target.dataset.deleteRecord) { const record = records.find((item) => item.id === target.dataset.deleteRecord); if (record && confirm(`Delete “${recordName(record)}” from this device?`)) { const usedElsewhere = new Set(records.filter((item) => item.id !== record.id).flatMap((item) => item.attachments.map((attachment) => attachment.localAssetId))); await store.deleteRecord(record.id); await store.deleteAssets(record.attachments.map((id) => id.localAssetId).filter((id) => !usedElsewhere.has(id))); selectedRecordIds.delete(record.id); await refresh(); toast("Observation deleted."); } } } catch (error) { toast(error.message); } });
  $("[data-task-list]").addEventListener("change", async (event) => { const input = event.target; if (!input.matches("[data-task-step]")) return; const task = tasks.find((item) => item.id === input.dataset.taskStep); if (!task) return; const steps = taskSteps(task).map((step, index) => ({ ...step, done: index === Number(input.value) ? input.checked : step.done })); const complete = steps.length && steps.every((step) => step.done); await store.saveTask({ ...task, steps, status: complete ? "completed" : "in-progress", completedAt: complete ? (task.completedAt || new Date().toISOString()) : null, updatedAt: new Date().toISOString(), revision: (task.revision || 1) + 1 }); await refresh(); });
  $("[data-task-list]").addEventListener("click", (event) => { const target = event.target.closest("button[data-note-from-task]"); if (!target) return; const task = tasks.find((item) => item.id === target.dataset.noteFromTask); if (!task) return; resetEditor(); const fields = $("[data-record-form]").elements; fields.collectionId.value = "task-notes"; fields.title.value = task.title || ""; fields.notes.value = task.notes || ""; if (Number.isFinite(task.longitude) && Number.isFinite(task.latitude)) setLocation({ coordinates: [task.longitude, task.latitude], source: "field-task", accuracyMeters: null }); $("[data-record-form]").dataset.taskId = task.id; switchView("collect"); });
  $("[data-export-geojson]").addEventListener("click", () => download("gismap-field-observations.geojson", JSON.stringify(recordsGeoJSON(selectedRecords().length ? selectedRecords() : records), null, 2), "application/geo+json"));
  $("[data-export-package]").addEventListener("click", async () => { try { const assets = await packageAssets(); download("gismap-field-observations.gisfield", JSON.stringify(makeFieldPackage(records, assets), null, 2), "application/vnd.gismap.field+json"); toast("Field package downloaded."); } catch (error) { toast(error.message); } });
  $("[data-import-package]").addEventListener("change", async (event) => { const [file] = event.target.files; if (!file) return; try { await importPackage(file); } catch (error) { toast(error.message); } event.target.value = ""; });
  $("[data-export-pdf]").addEventListener("click", async () => { try { const scope = selectedRecords(); const file = await reportFile(scope.length ? scope : records); download(file.name, file, file.type); toast("Field PDF downloaded. Open its location links on desktop to add a map later."); } catch (error) { toast(error.message); } });
  $("[data-share-records]").addEventListener("click", async () => { try { const scope = selectedRecords(); const file = await reportFile(scope.length ? scope : records); await mobileShare({ title: "GISMap Field report", text: "Field observations from GISMap Field Mode.", file }); } catch (error) { if (error.name !== "AbortError") toast(error.message); } });
  $("[data-import-qr]").addEventListener("click", async () => { try { await importQrText($("[data-qr-text]").value); $("[data-qr-text]").value = ""; } catch (error) { toast(error.message); } });
  ["[data-import-qr-image]", "[data-import-qr-camera-image]"].forEach((selector) => $(selector).addEventListener("change", async (event) => { const [file] = event.target.files; try { await importQrImage(file); } catch (error) { toast(error.message); } event.target.value = ""; }));
  $("[data-open-qr-import]").addEventListener("click", () => { switchView("transfer"); requestAnimationFrame(() => $("[data-start-qr-camera]").focus()); });
  $("[data-start-qr-camera]").addEventListener("click", () => scanQrWithCamera().catch((error) => toast(error.message)));
  $("[data-close-qr-scanner]").addEventListener("click", () => $("[data-qr-scanner-dialog]").close());
  $("[data-qr-scanner-dialog]").addEventListener("close", stopQrCamera);
  $("[data-close-qr]").addEventListener("click", () => $("[data-qr-dialog]").close());
  $("[data-download-qr]").addEventListener("click", async () => { try { const file = await qrCard(activeQrRecord); download(file.name, file, file.type); } catch (error) { toast(error.message); } });
  $("[data-share-qr]").addEventListener("click", async () => { try { const file = await qrCard(activeQrRecord); await mobileShare({ title: recordName(activeQrRecord), text: "GISMap Field Mode QR record. Attachments are not included.", file }); } catch (error) { if (error.name !== "AbortError") toast(error.message); } });
  $("[data-copy-qr]").addEventListener("click", async () => { try { await navigator.clipboard.writeText(encodeCompactFieldRecord(activeQrRecord)); toast("Compact record copied."); } catch { toast("Copy is unavailable in this browser."); } });
  $("[data-capability-details]").addEventListener("click", () => { const detail = $("[data-capabilities]"); detail.hidden = !detail.hidden; });
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
