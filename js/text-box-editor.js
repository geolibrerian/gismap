// Markup and form reading for the Draw panel's text box editor.
import { TEXT_BOX_FONTS, defaultRun, normalizeTextBox } from "./text-boxes.js?v=0.63.6-text-boxes";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const checked = (value) => (value ? " checked" : "");

export function textBoxSummary(box) {
  const text = box.runs.map((run) => run.text).join(" ").replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 39)}…` : text || "Empty text box";
}

export function textBoxRunMarkup(run, index) {
  const fonts = TEXT_BOX_FONTS.map((font) => `<option value="${font.id}"${font.id === run.font ? " selected" : ""}>${escape(font.label)}</option>`).join("");
  return `<fieldset class="text-box-run" data-text-run="${index}"><legend>Text run ${index + 1}</legend>
<label class="field"><span>Text</span><textarea rows="2" data-run-text>${escape(run.text)}</textarea></label>
<div class="field-grid">
<label class="field"><span>Font</span><select data-run-font>${fonts}</select></label>
<label class="field"><span>Size (px)</span><input type="number" min="6" max="144" step="1" data-run-size value="${run.size}"></label>
<label class="field"><span>Text colour</span><input type="color" data-run-color value="${run.color}"></label>
<label class="field"><span>Halo colour</span><input type="color" data-run-halo-color value="${run.haloColor}"></label>
<label class="field"><span>Halo width</span><input type="number" min="0" max="12" step="0.5" data-run-halo-width value="${run.haloWidth}"></label>
<label class="field text-box-checks"><span>Style</span><span><label><input type="checkbox" data-run-bold${checked(run.bold)}> Bold</label> <label><input type="checkbox" data-run-italic${checked(run.italic)}> Italic</label></span></label>
</div>
<button type="button" class="button--quiet" data-remove-run="${index}">Remove run</button></fieldset>`;
}

export function textBoxEditorMarkup(box) {
  const [longitude, latitude, z] = box.coordinates;
  const align = (value, label) => `<option value="${value}"${box.align === value ? " selected" : ""}>${label}</option>`;
  const frame = box.frame;
  return `<div class="workspace-tool text-box-editor">
<p class="form-note">Runs flow on one line; press Enter inside a run to start a new line. Each run has its own font, colour, and halo. Changes show on the map as you type.</p>
<fieldset class="feedback-settings"><legend>Position (centre)</legend><div class="field-grid">
<label class="field"><span>Longitude</span><input type="number" step="0.000001" min="-180" max="180" data-text-lon value="${longitude}"></label>
<label class="field"><span>Latitude</span><input type="number" step="0.000001" min="-90" max="90" data-text-lat value="${latitude}"></label>
<label class="field"><span>Z (metres)</span><input type="number" step="1" data-text-z value="${z}"></label>
<label class="field"><span>Alignment</span><select data-text-align>${align("left", "Left")}${align("center", "Centre")}${align("right", "Right")}</select></label>
<label class="field"><span>Min zoom (optional)</span><input type="number" min="0" max="24" step="0.5" placeholder="Any" data-text-min-zoom value="${box.minZoom ?? ""}"></label>
<label class="field"><span>Max zoom (optional)</span><input type="number" min="0" max="24" step="0.5" placeholder="Any" data-text-max-zoom value="${box.maxZoom ?? ""}"></label>
</div><p class="form-note" data-text-zoom-note></p><button type="button" data-text-pick>Pick position on map</button></fieldset>
<div data-text-runs>${box.runs.map(textBoxRunMarkup).join("")}</div>
<button type="button" data-add-run>Add text run</button>
<fieldset class="feedback-settings"><legend><label><input type="checkbox" data-frame-enabled${checked(frame.enabled)}> Rectangle around label</label></legend><div class="field-grid">
<label class="field"><span>Fill colour</span><input type="color" data-frame-fill value="${frame.fill}"></label>
<label class="opacity-row"><span>Fill opacity</span><input type="range" min="0" max="1" step="0.05" data-frame-fill-opacity value="${frame.fillOpacity}"><output data-frame-fill-output>${Math.round(frame.fillOpacity * 100)}%</output></label>
<label class="field"><span>Outline colour</span><input type="color" data-frame-outline value="${frame.outline}"></label>
<label class="field"><span>Outline width</span><input type="number" min="0" max="12" step="0.5" data-frame-outline-width value="${frame.outlineWidth}"></label>
<label class="field"><span>Padding</span><input type="number" min="0" max="60" step="1" data-frame-padding value="${frame.padding}"></label>
<label class="field"><span>Corner radius</span><input type="number" min="0" max="40" step="1" data-frame-radius value="${frame.radius}"></label>
</div></fieldset>
<div class="workspace-tool__actions"><button type="button" class="button--quiet" data-text-delete>Delete text box</button><button type="button" class="button--primary" data-text-done>Done</button></div>
</div>`;
}

export function readTextBoxEditor(root, id) {
  const value = (selector, scope = root) => scope.querySelector(selector)?.value;
  const on = (selector, scope = root) => scope.querySelector(selector)?.checked === true;
  const runs = [...root.querySelectorAll("[data-text-run]")].map((scope) => ({
    text: value("[data-run-text]", scope),
    font: value("[data-run-font]", scope),
    size: Number(value("[data-run-size]", scope)),
    bold: on("[data-run-bold]", scope),
    italic: on("[data-run-italic]", scope),
    color: value("[data-run-color]", scope),
    haloColor: value("[data-run-halo-color]", scope),
    haloWidth: Number(value("[data-run-halo-width]", scope)),
  }));
  return normalizeTextBox({
    id,
    coordinates: [Number(value("[data-text-lon]")), Number(value("[data-text-lat]")), Number(value("[data-text-z]"))],
    align: value("[data-text-align]"),
    minZoom: value("[data-text-min-zoom]"),
    maxZoom: value("[data-text-max-zoom]"),
    runs: runs.length ? runs : [defaultRun({ text: "" })],
    frame: {
      enabled: on("[data-frame-enabled]"),
      fill: value("[data-frame-fill]"),
      fillOpacity: Number(value("[data-frame-fill-opacity]")),
      outline: value("[data-frame-outline]"),
      outlineWidth: Number(value("[data-frame-outline-width]")),
      padding: Number(value("[data-frame-padding]")),
      radius: Number(value("[data-frame-radius]")),
    },
  });
}
