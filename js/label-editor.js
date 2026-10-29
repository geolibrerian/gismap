// Markup and form reading for a layer's Labels editor.
import { TEXT_BOX_FONTS } from "./text-boxes.js?v=0.64.3-tests";
import { normalizeLabeling } from "./layer-labels.js?v=0.64.3-tests";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const checked = (value) => (value ? " checked" : "");
const option = (value, label, selected) => `<option value="${escape(value)}"${value === selected ? " selected" : ""}>${escape(label)}</option>`;

/** Fields a label can show (no geometry, blobs or raw IDs). */
export function labelableFields(layer) {
  return (layer?.fields || []).filter((field) => !/geometry|blob|raster|xml/i.test(String(field.type || "")));
}

export function labelEditorMarkup(layer, spec) {
  const fields = labelableFields(layer);
  const numeric = fields.filter((field) => /integer|double|single|float|number|small|long|decimal/i.test(String(field.type || "")));
  const fieldOptions = (selected, list = fields) => list.map((field) => option(field.name, field.alias && field.alias !== field.name ? `${field.alias} (${field.name})` : field.name, selected)).join("");
  const fonts = TEXT_BOX_FONTS.map((font) => option(font.id, font.label, spec.style.font)).join("");
  const frame = spec.frame;
  return `<div class="workspace-tool label-editor">
<label class="menu__toggle"><input type="checkbox" data-label-enabled${checked(spec.enabled)}><span>Show labels for this layer</span></label>
<fieldset class="feedback-settings"><legend>Label text</legend>
<label class="field"><span>Text from</span><select data-label-mode>${option("field", "A field's value", spec.mode)}${option("template", "A template (text or HTML with {FIELD} wildcards)", spec.mode)}${option("single", "The same text for every feature", spec.mode)}</select></label>
<label class="field" data-label-field-row><span>Field</span><select data-label-field><option value="">Choose a field…</option>${fieldOptions(spec.field)}</select></label>
<div data-label-template-row>
<label class="field"><span data-label-template-title>Template</span><textarea rows="4" spellcheck="false" data-label-template placeholder="<b>{NAME}</b><br><small>{ACRES:0} acres</small>">${escape(spec.template)}</textarea></label>
<div class="label-editor__chips" data-label-chips><span>Insert field:</span>${fields.map((field) => `<button type="button" data-insert-field="${escape(field.name)}">${escape(field.name)}</button>`).join("") || '<em>No fields</em>'}</div>
<p class="form-note">{FIELD} inserts a value; {FIELD:1} rounds a number to one decimal. HTML: &lt;b&gt;, &lt;i&gt;, &lt;br&gt;, &lt;small&gt;, &lt;big&gt;, &lt;p&gt;, and &lt;span style="color:#c0392b; font-size:16px"&gt;. Values from the data are shown as text, never as HTML.</p>
</div>
</fieldset>
<fieldset class="feedback-settings"><legend>Style</legend><div class="field-grid">
<label class="field"><span>Font</span><select data-label-font>${fonts}</select></label>
<label class="field"><span>Size (px)</span><input type="number" min="6" max="144" step="1" data-label-size value="${spec.style.size}"></label>
<label class="field"><span>Text colour</span><input type="color" data-label-color value="${spec.style.color}"></label>
<label class="field"><span>Halo colour</span><input type="color" data-label-halo-color value="${spec.style.haloColor}"></label>
<label class="field"><span>Halo width</span><input type="number" min="0" max="12" step="0.5" data-label-halo-width value="${spec.style.haloWidth}"></label>
<label class="field"><span>Alignment</span><select data-label-align>${option("left", "Left", spec.align)}${option("center", "Centre", spec.align)}${option("right", "Right", spec.align)}</select></label>
<label class="field text-box-checks"><span>Style</span><span><label><input type="checkbox" data-label-bold${checked(spec.style.bold)}> Bold</label> <label><input type="checkbox" data-label-italic${checked(spec.style.italic)}> Italic</label></span></label>
</div></fieldset>
<fieldset class="feedback-settings"><legend><label><input type="checkbox" data-label-frame${checked(frame.enabled)}> Rectangle around each label</label></legend><div class="field-grid">
<label class="field"><span>Fill colour</span><input type="color" data-label-frame-fill value="${frame.fill}"></label>
<label class="opacity-row"><span>Fill opacity</span><input type="range" min="0" max="1" step="0.05" data-label-frame-opacity value="${frame.fillOpacity}"><output>${Math.round(frame.fillOpacity * 100)}%</output></label>
<label class="field"><span>Outline colour</span><input type="color" data-label-frame-outline value="${frame.outline}"></label>
<label class="field"><span>Outline width</span><input type="number" min="0" max="12" step="0.5" data-label-frame-width value="${frame.outlineWidth}"></label>
<label class="field"><span>Padding</span><input type="number" min="0" max="40" step="1" data-label-frame-padding value="${frame.padding}"></label>
<label class="field"><span>Corner radius</span><input type="number" min="0" max="30" step="1" data-label-frame-radius value="${frame.radius}"></label>
</div></fieldset>
<fieldset class="feedback-settings"><legend>Placement</legend><div class="field-grid">
<label class="field"><span>Height (Z)</span><select data-label-z-mode>${option("ground", "On the ground", spec.zMode)}${option("above", "Height above the ground", spec.zMode)}${option("constant", "Height above sea level", spec.zMode)}${option("geometry", "Feature's own Z", spec.zMode)}${option("field", "From a field (metres)", spec.zMode)}</select></label>
<label class="field" data-label-z-field-row><span>Z field</span><select data-label-z-field><option value="">Choose a field…</option>${fieldOptions(spec.zField, numeric.length ? numeric : fields)}</select></label>
<label class="menu__toggle" data-label-z-field-ground-row><input type="checkbox" data-label-z-field-ground${checked(spec.zFieldAboveGround)}><span>Field values are above the ground</span></label>
<label class="field" data-label-z-value-row><span>Metres</span><input type="number" step="1" data-label-z-value value="${spec.zValue}"></label>
<label class="field"><span>Min zoom (optional)</span><input type="number" min="0" max="24" step="0.5" placeholder="Any" data-label-min-zoom value="${spec.minZoom ?? ""}"></label>
<label class="field"><span>Max zoom (optional)</span><input type="number" min="0" max="24" step="0.5" placeholder="Any" data-label-max-zoom value="${spec.maxZoom ?? ""}"></label>
<label class="field"><span>Most labels shown</span><input type="number" min="1" max="2000" step="1" data-label-max value="${spec.maxLabels}"></label>
</div>
<label class="menu__toggle"><input type="checkbox" data-label-avoid${checked(spec.avoidOverlap)}><span>Hide labels that would overlap</span></label>
<p class="form-note">Points are labelled at the point, lines at their middle and polygons at their centre. Labels follow the map and appear in PDFs, Smart Images and Print Editor pages.</p>
</fieldset>
<div class="workspace-tool__actions text-box-editor"><button type="button" class="button--quiet" data-label-remove>Remove labels</button><button type="button" class="button--primary" data-label-done>Done</button></div>
</div>`;
}

/** Shows only the rows that apply to the chosen text source and height. */
export function syncLabelEditor(root) {
  const mode = root.querySelector("[data-label-mode]").value;
  root.querySelector("[data-label-field-row]").hidden = mode !== "field";
  root.querySelector("[data-label-template-row]").hidden = mode === "field";
  root.querySelector("[data-label-chips]").hidden = mode !== "template";
  root.querySelector("[data-label-template-title]").textContent = mode === "single" ? "Text (plain or HTML)" : "Template";
  const zMode = root.querySelector("[data-label-z-mode]").value;
  root.querySelector("[data-label-z-field-row]").hidden = zMode !== "field";
  root.querySelector("[data-label-z-field-ground-row]").hidden = zMode !== "field";
  root.querySelector("[data-label-z-value-row]").hidden = !["constant", "above"].includes(zMode);
  const opacity = root.querySelector("[data-label-frame-opacity]");
  opacity.nextElementSibling.value = `${Math.round(Number(opacity.value) * 100)}%`;
}

export function readLabelEditor(root) {
  const value = (selector) => root.querySelector(selector)?.value;
  const on = (selector) => root.querySelector(selector)?.checked === true;
  return normalizeLabeling({
    enabled: on("[data-label-enabled]"),
    mode: value("[data-label-mode]"),
    field: value("[data-label-field]"),
    template: value("[data-label-template]"),
    style: {
      font: value("[data-label-font]"),
      size: Number(value("[data-label-size]")),
      bold: on("[data-label-bold]"),
      italic: on("[data-label-italic]"),
      color: value("[data-label-color]"),
      haloColor: value("[data-label-halo-color]"),
      haloWidth: Number(value("[data-label-halo-width]")),
    },
    align: value("[data-label-align]"),
    frame: {
      enabled: on("[data-label-frame]"),
      fill: value("[data-label-frame-fill]"),
      fillOpacity: Number(value("[data-label-frame-opacity]")),
      outline: value("[data-label-frame-outline]"),
      outlineWidth: Number(value("[data-label-frame-width]")),
      padding: Number(value("[data-label-frame-padding]")),
      radius: Number(value("[data-label-frame-radius]")),
    },
    zMode: value("[data-label-z-mode]"),
    zField: value("[data-label-z-field]"),
    zFieldAboveGround: on("[data-label-z-field-ground]"),
    zValue: Number(value("[data-label-z-value]")),
    minZoom: value("[data-label-min-zoom]"),
    maxZoom: value("[data-label-max-zoom]"),
    maxLabels: Number(value("[data-label-max]")),
    avoidOverlap: on("[data-label-avoid]"),
  });
}
