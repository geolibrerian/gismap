// Tools > Spatial Analysis: choose layers or drawings, draw on the map, add the result as a layer.
import { SPATIAL_OPERATIONS } from "./spatial-analysis.js?v=0.67.0-hexbin";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
const GEOMETRY_NOTE = { polygon: "polygons", point: "points", any: "any geometry" };
const MULTI_CLICK_HINT = "Click to add points, then double-click to finish.";
const DRAW_HINTS = { point: "Click the map to place the point.", polyline: MULTI_CLICK_HINT, polygon: MULTI_CLICK_HINT, rectangle: "Drag on the map to draw the rectangle." };
const DRAW_TYPES = [["point", "Point"], ["polyline", "Line"], ["polygon", "Polygon"], ["rectangle", "Rectangle"]];

/** `preset` picks the operation and input to start with, as a layer card's Hexagon map does. */
export function openSpatialAnalysis(ui, analysis, preset = {}) {
  const groups = [...new Set(SPATIAL_OPERATIONS.map((item) => item.group))];
  const operationOptions = groups.map((group) => `<optgroup label="${group}">${SPATIAL_OPERATIONS.filter((item) => item.group === group).map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join("")}</optgroup>`).join("");
  ui.openDialog({
    eyebrow: "Tools",
    title: "Spatial Analysis",
    content: `<div class="workspace-tool spatial-analysis">
      <label class="field"><span>Analysis</span><select data-analysis-operation>${operationOptions}</select></label>
      <p class="form-note" data-analysis-description></p>
      <label class="field"><span>Input</span><select data-analysis-input></select></label>
      <label class="field" data-analysis-overlay-field><span data-analysis-overlay-label>Overlay</span><select data-analysis-overlay></select></label>
      <div data-analysis-options></div>
      <datalist id="spatial-analysis-fields" data-analysis-fields></datalist>
      <fieldset class="spatial-analysis__draw"><legend>Draw on the map</legend>
        <div class="draw-tools">${DRAW_TYPES.map(([type, label]) => `<button type="button" data-analysis-draw="${type}">${label}</button>`).join("")}<button type="button" class="button--quiet" data-analysis-clear>Clear</button></div>
        <p class="form-note" data-analysis-drawings></p>
      </fieldset>
      <button type="button" class="button--primary" data-analysis-run>Run analysis</button>
      <p class="form-note" data-analysis-output role="status"></p>
      <p class="form-note">Runs in this browser. Nothing is uploaded.</p>
    </div>`,
  });
  // Docked, the dialog leaves the map free to draw on.
  document.querySelector("#dialog-dock")?.click();
  const root = ui.dialog.querySelector(".spatial-analysis");
  const get = (name) => root.querySelector(`[data-analysis-${name}]`);
  const controller = ui.mapController;
  const current = () => SPATIAL_OPERATIONS.find((item) => item.id === get("operation").value);
  const sources = (optional = false) => {
    const count = controller.getDrawings().length;
    const layers = globalThis.gisMapOnline.layers.list().filter((layer) => controller.getLayer(layer.id)?.queryable);
    return [optional ? '<option value="">None</option>' : "", `<option value="drawings">Drawings on the map (${count})</option>`, ...layers.map((layer) => `<option value="${escapeHtml(layer.id)}">${escapeHtml(layer.title)}</option>`)].join("");
  };
  // Field suggestions come from the input layer; a typed name still works for drawings and GeoJSON.
  const refreshFields = () => {
    const fields = controller.getLayer(get("input").value)?.fields || [];
    get("fields").innerHTML = fields.filter((field) => /integer|double|single|small|long|number/i.test(String(field.type))).map((field) => `<option value="${escapeHtml(field.name)}"></option>`).join("");
  };
  const optionInput = (option) => {
    const data = `data-option="${option.name}"`;
    if (option.type === "choice") return `<select ${data}>${option.choices.map(([id, label]) => `<option value="${escapeHtml(id)}"${id === option.default ? " selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select>`;
    if (option.type === "number") return `<input ${data} type="number" value="${option.default}" min="${option.min}" max="${option.max}" step="${option.integer ? 1 : "any"}" />`;
    if (option.type === "field") return `<input ${data} type="text" list="spatial-analysis-fields" autocomplete="off" />`;
    return `<input ${data} type="text" />`;
  };
  const optionMarkup = (option) => option.type === "boolean"
    ? `<label class="display-checkbox" data-option-row="${option.name}"><input data-option="${option.name}" type="checkbox"${option.default ? " checked" : ""} /><span>${escapeHtml(option.label)}</span></label>`
    : `<label class="field" data-option-row="${option.name}"><span>${escapeHtml(option.label)}${option.unit ? ` (${option.unit})` : ""}</span>${optionInput(option)}</label>`;
  // An option with `when` shows only while the options it depends on have one of the listed values.
  const syncOptions = () => {
    for (const option of current().options.filter((item) => item.when)) {
      const row = root.querySelector(`[data-option-row="${option.name}"]`);
      row.hidden = !Object.entries(option.when).every(([name, allowed]) => allowed.includes(root.querySelector(`[data-option="${name}"]`)?.value));
    }
  };
  let hint = "";
  let drawn = controller.getDrawings().length;
  const refreshSources = () => {
    for (const select of [get("input"), get("overlay")]) {
      const chosen = select.value;
      select.innerHTML = sources(select === get("overlay") && current().overlayOptional);
      if ([...select.options].some((option) => option.value === chosen)) select.value = chosen;
    }
    const count = controller.getDrawings().length;
    if (count !== drawn) hint = "";
    drawn = count;
    get("drawings").textContent = hint || (count ? `${count} drawn ${count === 1 ? "shape" : "shapes"}. Choose Drawings on the map as the input or overlay.` : "Pick a shape, then draw it on the map.");
  };
  const renderOperation = () => {
    const operation = current();
    get("description").textContent = `${operation.description} Input: ${GEOMETRY_NOTE[operation.input]}.`;
    get("overlay-field").hidden = !operation.overlay;
    get("overlay-label").textContent = operation.overlayOptional ? "Study area (optional)" : "Overlay";
    get("options").innerHTML = operation.options.map(optionMarkup).join("");
    syncOptions();
  };
  get("operation").addEventListener("change", () => {
    renderOperation();
    refreshSources();
    // An optional overlay starts at None, whatever the last operation's overlay was.
    if (current().overlayOptional) get("overlay").value = "";
  });
  get("options").addEventListener("change", syncOptions);
  get("input").addEventListener("change", refreshFields);
  root.querySelectorAll("[data-analysis-draw]").forEach((button) => button.addEventListener("click", () => {
    controller.draw(button.dataset.analysisDraw);
    hint = DRAW_HINTS[button.dataset.analysisDraw];
    refreshSources();
    get("input").value = "drawings";
    if (ui.mobileMedia.matches) drawOnMobile(ui);
  }));
  get("clear").addEventListener("click", () => { controller.clearDrawings(); refreshSources(); });
  get("run").addEventListener("click", async () => {
    const operation = current();
    const output = get("output");
    const options = Object.fromEntries([...root.querySelectorAll("[data-option]")].filter((field) => !field.closest("[hidden]") && (field.type === "checkbox" || field.value !== "")).map((field) => [field.dataset.option, field.type === "checkbox" ? field.checked : field.value]));
    output.textContent = "Running…";
    get("run").disabled = true;
    try {
      // A shape still in progress counts, so Run works without the double-click.
      controller.engine?.finishDrawing?.();
      await new Promise((resolve) => setTimeout(resolve, 50));
      refreshSources();
      const result = await analysis.run(operation.id, { input: get("input").value, overlay: operation.overlay && get("overlay").value ? get("overlay").value : undefined, options });
      output.textContent = result.summary;
      ui.toast(result.summary);
      refreshSources();
    } catch (error) {
      output.textContent = error.message;
    } finally {
      get("run").disabled = false;
    }
  });
  if (SPATIAL_OPERATIONS.some((item) => item.id === preset.operation)) get("operation").value = preset.operation;
  renderOperation();
  refreshSources();
  if (current().overlayOptional) get("overlay").value = "";
  if (preset.input && [...get("input").options].some((option) => option.value === preset.input)) get("input").value = preset.input;
  refreshFields();
  const refresh = setInterval(() => {
    if (!root.isConnected) clearInterval(refresh);
    else if (!root.contains(document.activeElement) || document.activeElement.tagName !== "SELECT") refreshSources();
  }, 800);
}

/** On a phone the sheet covers the map, so it steps aside until drawing is done. */
function drawOnMobile(ui) {
  ui.dialog.style.display = "none";
  const done = document.createElement("button");
  done.type = "button";
  done.className = "button--primary spatial-analysis__done";
  done.textContent = "Done drawing";
  done.addEventListener("click", () => { ui.dialog.style.display = ""; done.remove(); });
  document.body.append(done);
}
