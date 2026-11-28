// Tools › Infographics: the Flow Map editor.
//
// GISMap owns the editor, queries, selection, the accessible table and export;
// the pure engine (flow-map.js) turns rows into a model and flow-map-svg.js
// turns the model into one SVG string used for preview and export alike.

import { COUNTRY_POINTS_ID, COUNTRY_POINTS_REVISION, countryPointLookup } from "./country-points.js";
import { BEVERAGE_FIXTURE_FIELDS, BEVERAGE_FIXTURE_ID, BEVERAGE_FIXTURE_NAME, beverageFixtureRecipe, beverageFixtureRows } from "./flow-fixtures.js";
import { EXCLUSION_REASONS, FLOW_MAP_MAX_LINKS, LOCAL_ROW_LIMIT, MAX_ANNOTATIONS, buildFlowMapModel, endpointExtent, normalizeFlowRecipe, suggestFlowBindings } from "./flow-map.js";
import { escapeXml as escape, flowDetail, flowLabel, formatValue, renderFlowMapSvg, scopeLabel } from "./flow-map-svg.js";
import { flowMapGeo, loadGeoModules } from "./infographics-geo.js";

const PAGE_SIZE = 12;
const fieldLabel = (field) => field.alias && field.alias !== field.name ? `${field.alias} (${field.name})` : field.name;
const slug = (value) => String(value || "flow-map").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "flow-map";

/** Convert a Web Mercator extent to WGS84, so either engine's view can scope flows. */
export function extentToWgs84(extent) {
  if (!extent) return null;
  const wkid = extent.spatialReference?.latestWkid || extent.spatialReference?.wkid;
  if (!wkid || wkid === 4326) return { xmin: extent.xmin, ymin: extent.ymin, xmax: extent.xmax, ymax: extent.ymax };
  if (wkid !== 3857 && wkid !== 102100) return null;
  const R = 6378137;
  const lon = (x) => (x / R) * (180 / Math.PI);
  const lat = (y) => (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI);
  const width = extent.xmax - extent.xmin;
  if (width >= 2 * Math.PI * R) return { xmin: -180, ymin: lat(extent.ymin), xmax: 180, ymax: lat(extent.ymax) };
  const wrap = (value) => ((value + 540) % 360) - 180;
  return { xmin: wrap(lon(extent.xmin)), ymin: lat(extent.ymin), xmax: wrap(lon(extent.xmax)), ymax: lat(extent.ymax) };
}

/**
 * Open the editor in the app dialog.
 * host: { openDialog, dialog, mapController, toast, error, activeLayerId }
 */
export async function openInfographicsEditor(host, { layerUid = null } = {}) {
  const { mapController } = host;
  const lookup = countryPointLookup();
  const layers = (mapController?.getLayers?.() || []).filter((layer) => layer.queryable);
  const initialSource = layerUid && layers.some((layer) => layer.uid === layerUid) ? layerUid : BEVERAGE_FIXTURE_ID;
  const state = {
    source: initialSource,
    fields: [],
    rows: [],
    coverage: { complete: true, label: "Complete" },
    extent: null,
    recipe: normalizeFlowRecipe(beverageFixtureRecipe()),
    model: null,
    selectedKey: null,
    page: 1,
    request: 0,
    geoModules: null,
    geoError: null,
    playing: false,
    signatures: {},
    loading: false,
  };

  host.openDialog({
    eyebrow: "Infographics",
    title: "Flow Map",
    content: shellMarkup(layers, state.source),
    actions: [
      { label: "Play", handler: () => play() },
      { label: "Copy recipe", handler: () => copyRecipe() },
      { label: "Export SVG", handler: () => exportSvg() },
      { label: "Export PNG", primary: true, handler: () => exportPng() },
    ],
  });
  const root = host.dialog.querySelector("[data-infographic]");
  const $ = (selector) => root.querySelector(selector);
  const session = host.dialogSession;
  const alive = () => host.dialog.open && root.isConnected && (session === undefined || host.dialogSession === session);

  // ---- geography (lazy)
  $("[data-ig-status]").textContent = "Loading map projection and boundaries…";
  loadGeoModules().then((modules) => { state.geoModules = modules; if (alive()) render(); }).catch((error) => { state.geoError = error; if (alive()) render(); });

  // ---- data
  async function loadSource() {
    const request = ++state.request;
    state.selectedKey = null;
    state.page = 1;
    if (state.source === BEVERAGE_FIXTURE_ID) {
      state.fields = BEVERAGE_FIXTURE_FIELDS.slice();
      state.rows = beverageFixtureRows();
      state.coverage = { complete: true, label: "Complete" };
      state.recipe = normalizeFlowRecipe({ ...beverageFixtureRecipe(), id: state.recipe.id, query: { ...beverageFixtureRecipe().query, scope: { type: "all" } } });
      renderInspector();
      render();
      return;
    }
    const layer = mapController.getLayer(state.source);
    state.loading = true;
    setStatus(`Reading ${layer?.title || "layer"}…`);
    try {
      const loaded = await mapController.loadLayer(state.source, { allowTruncated: false });
      if (request !== state.request || !alive()) return;
      const fields = loaded.fields || layer?.fields || [];
      const sameLayer = state.recipe.source.layerId === state.source;
      if (!sameLayer) {
        const suggested = suggestFlowBindings(fields);
        state.recipe = normalizeFlowRecipe({
          id: state.recipe.id,
          title: `${loaded.title || "Layer"} flows`,
          subtitle: "",
          source: { layerId: state.source, name: loaded.title || layer?.title || "Layer" },
          query: { scope: { type: "filtered" } },
          bindings: { ...suggested, lookup: { id: COUNTRY_POINTS_ID, revision: COUNTRY_POINTS_REVISION } },
          design: { ...state.recipe.design, hiddenCategories: [] },
        });
      }
      state.fields = fields;
      renderInspector();
      await queryRows(loaded);
    } catch (error) {
      if (request !== state.request || !alive()) return;
      state.rows = [];
      setStatus(error.message || "The layer could not be read.", true);
    } finally {
      if (request === state.request) state.loading = false;
    }
  }

  /** Query the bound fields for the chosen scope. Stale replies are ignored. */
  async function queryRows(loaded = mapController.getLayer(state.source)) {
    if (state.source === BEVERAGE_FIXTURE_ID) { render(); return; }
    const request = ++state.request;
    const { bindings, query } = state.recipe;
    const outFields = [...new Set([bindings.origin.idField, bindings.destination.idField, bindings.origin.lonField, bindings.origin.latField, bindings.destination.lonField, bindings.destination.latField, bindings.weight.field, bindings.categoryField, bindings.periodField].filter(Boolean))];
    if (!outFields.length) { state.rows = []; render(); return; }
    setStatus("Querying…");
    const scope = query.scope.type;
    const params = { where: scope === "all" ? "1=1" : undefined, outFields, returnGeometry: false };
    try {
      const response = await mapController.queryFeatures(loaded.uid, params, { layerDefaults: scope !== "all" });
      if (request !== state.request || !alive()) return;
      const features = response.features || [];
      state.rows = features.slice(0, LOCAL_ROW_LIMIT + 1).map((feature) => feature.attributes || {});
      state.extent = scope === "extent" ? extentToWgs84(mapController.getViewExtent?.()) : null;
      const partial = response.exceededTransferLimit === true;
      state.coverage = partial ? { complete: false, label: "Partial" } : { complete: true, label: "Complete" };
      if (scope === "extent" && !state.extent) state.coverage = { complete: false, label: "Extent unavailable" };
      render();
    } catch (error) {
      if (request !== state.request || !alive()) return;
      setStatus(error.message || "The query failed.", true);
    }
  }

  // ---- inspector
  function renderInspector() {
    $("[data-ig-data]").innerHTML = dataMarkup(state);
    $("[data-ig-design]").innerHTML = designMarkup(state.recipe);
    state.signatures = {};
    syncModeVisibility();
  }

  function syncModeVisibility() {
    const mode = state.recipe.bindings.mode;
    root.querySelectorAll("[data-ig-for-mode]").forEach((element) => { element.hidden = element.dataset.igForMode !== mode; });
  }

  function readInspector() {
    const value = (name) => root.querySelector(`[data-ig="${name}"]`)?.value ?? "";
    const previous = state.recipe;
    const mode = root.querySelector('[name="ig-mode"]:checked')?.value || previous.bindings.mode;
    const periodChoice = value("period-choice");
    const hidden = [...root.querySelectorAll("[data-ig-category]")].filter((box) => !box.checked).map((box) => box.value);
    const annotations = [...root.querySelectorAll("[data-ig-note]")].map((row, index) => ({ id: `note-${index + 1}`, anchor: { type: "flow", key: row.querySelector("[data-ig-note-key]").value }, text: row.querySelector("[data-ig-note-text]").value.trim() }));
    state.recipe = normalizeFlowRecipe({
      ...previous,
      title: value("title"),
      subtitle: value("subtitle"),
      query: { ...previous.query, scope: { type: value("scope") || previous.query.scope.type }, period: periodChoice && periodChoice !== "__all" ? periodChoice : null, aggregatePeriods: periodChoice === "__all" },
      bindings: {
        mode,
        origin: { idField: value("origin-id") || null, lonField: value("origin-lon") || null, latField: value("origin-lat") || null },
        destination: { idField: value("destination-id") || null, lonField: value("destination-lon") || null, latField: value("destination-lat") || null },
        lookup: mode === "ids" ? { id: COUNTRY_POINTS_ID, revision: COUNTRY_POINTS_REVISION } : null,
        weight: { field: value("weight") || null, unit: value("unit") },
        categoryField: value("category") || null,
        periodField: value("period") || null,
      },
      design: { layout: value("layout"), theme: value("theme"), projection: value("projection"), topN: value("top-n") === "" ? previous.design.topN : Number(value("top-n")), hiddenCategories: hidden },
      annotations: annotations.filter((note) => note.anchor.key && note.text),
    });
  }

  /** Update the data-dependent inspector parts only when their contents change, so focus survives. */
  function syncDynamicInspector(model) {
    const { resolved } = model;
    const periodSignature = JSON.stringify([resolved.periods, state.recipe.query.period, state.recipe.query.aggregatePeriods]);
    if (state.signatures.period !== periodSignature) {
      state.signatures.period = periodSignature;
      const container = $("[data-ig-period-choice]");
      container.hidden = resolved.periods.length < 2;
      container.innerHTML = resolved.periods.length < 2 ? "" : `<label class="field"><span>Period</span><select data-ig="period-choice"><option value="">Choose a period…</option>${resolved.periods.map((period) => `<option value="${escape(period)}"${String(state.recipe.query.period) === period ? " selected" : ""}>${escape(period)}</option>`).join("")}<option value="__all"${state.recipe.query.aggregatePeriods ? " selected" : ""}>All periods, summed</option></select><small>Summing is only valid when every period uses the same measure and unit.</small></label>`;
    }
    const categorySignature = JSON.stringify([resolved.categories.map((category) => category.name), state.recipe.design.hiddenCategories]);
    if (state.signatures.categories !== categorySignature) {
      state.signatures.categories = categorySignature;
      $("[data-ig-categories]").innerHTML = resolved.categories.length
        ? `<fieldset class="infographic-editor__toggles"><legend>Show categories</legend>${resolved.categories.map((category) => `<label><input type="checkbox" data-ig-category value="${escape(category.name)}"${state.recipe.design.hiddenCategories.includes(category.name) ? "" : " checked"}> ${escape(category.name)} <small>${escape(formatValue(category.weight, resolved.unit))}</small></label>`).join("")}</fieldset>`
        : "";
    }
    const flowOptions = resolved.flows.slice(0, 200);
    const noteSignature = JSON.stringify([flowOptions.map((flow) => flow.key), state.recipe.annotations]);
    if (state.signatures.notes !== noteSignature) {
      state.signatures.notes = noteSignature;
      const notes = state.recipe.annotations;
      $("[data-ig-annotations]").innerHTML = Array.from({ length: MAX_ANNOTATIONS }, (_, index) => {
        const note = notes[index];
        const options = flowOptions.map((flow) => `<option value="${escape(flow.key)}"${note?.anchor.key === flow.key ? " selected" : ""}>${escape(`${flowLabel(flow)}${flow.category ? ` · ${flow.category}` : ""}`)}</option>`).join("");
        const missing = note && !flowOptions.some((flow) => flow.key === note.anchor.key) ? `<option value="${escape(note.anchor.key)}" selected>${escape(note.anchor.key)} (not in this result)</option>` : "";
        return `<div class="infographic-editor__note" data-ig-note><label class="field"><span>Note ${index + 1} attaches to</span><select data-ig-note-key><option value="">No note</option>${missing}${options}</select></label><label class="field"><span>Text</span><input type="text" maxlength="240" data-ig-note-text value="${escape(note?.text || "")}" placeholder="What should readers notice?"></label><small data-ig-note-status></small></div>`;
      }).join("");
    }
    // Statuses change with the scope even when the inputs do not.
    root.querySelectorAll("[data-ig-note]").forEach((row, index) => {
      const note = model.annotations.find((item) => item.id === `note-${index + 1}`);
      const status = row.querySelector("[data-ig-note-status]");
      status.textContent = !note ? "" : note.status === "shown" ? "Shown on the map." : note.status === "hidden-by-design" ? "Its flow is hidden by Top N or a category toggle." : "Its flow is outside the current result, so the note is not drawn.";
    });
  }

  // ---- render
  function setStatus(message, isError = false) {
    const status = $("[data-ig-status]");
    status.textContent = message;
    status.classList.toggle("is-error", isError);
  }

  function render() {
    if (!alive()) return;
    const model = buildFlowMapModel(state.rows, state.recipe, { lookup, extent: state.extent, coverage: state.coverage });
    state.model = model;
    syncDynamicInspector(model);
    const { resolved, ranking } = model;
    const geo = state.geoModules ? flowMapGeo(state.geoModules, state.recipe.design.projection) : null;
    if (state.selectedKey && !ranking.displayed.some((flow) => flow.key === state.selectedKey)) state.selectedKey = null;
    const { svg } = renderFlowMapSvg(model, { geo, selectedKey: state.selectedKey, animate: true });
    $("[data-ig-canvas]").innerHTML = svg;
    const parts = [];
    if (state.geoError) parts.push(`Map boundaries could not load (${state.geoError.message}); flows are listed without the map.`);
    else if (!state.geoModules) parts.push("Loading map projection and boundaries…");
    if (resolved.blocking) parts.push(resolved.blocking.message);
    else parts.push(`${scopeLabel(state.recipe.query.scope.type)} · ${state.coverage.label} · ${resolved.summary.inputRows.toLocaleString("en")} rows → ${ranking.resolvedCount} flow${ranking.resolvedCount === 1 ? "" : "s"}, ${ranking.displayedCount} shown${ranking.hiddenCategories.length ? ` (${ranking.hiddenCategories.join(", ")} hidden)` : ""}.`);
    if (resolved.summary.excludedRows) parts.push(`${resolved.summary.excludedRows} row${resolved.summary.excludedRows === 1 ? "" : "s"} excluded; see Diagnostics.`);
    setStatus(parts.join(" "), Boolean(resolved.blocking || state.geoError));
    renderSelection();
    renderTable();
    renderDiagnostics();
  }

  function selectedFlow() {
    return state.model?.ranking.displayed.find((flow) => flow.key === state.selectedKey) || null;
  }

  function renderSelection() {
    const flow = selectedFlow();
    $("[data-ig-detail]").textContent = flow ? flowDetail(flow, state.model.resolved.unit) : "Select a ribbon or a row to see its details.";
    $("[data-ig-clear]").disabled = !flow;
    $("[data-ig-zoom]").disabled = !flow || !mapController?.setView;
    const svg = $("[data-ig-canvas] svg");
    if (!svg) return;
    svg.classList.toggle("has-selection", Boolean(flow));
    svg.querySelectorAll("[data-flow-key]").forEach((mark) => mark.classList.toggle("is-selected", mark.dataset.flowKey === state.selectedKey));
  }

  function select(key) {
    const changed = state.selectedKey !== key;
    state.selectedKey = key;
    // Re-render so the selected ribbon draws on top and its endpoints are labelled.
    if (changed) render(); else renderSelection();
  }

  function renderTable() {
    const { ranking, resolved } = state.model;
    const rows = ranking.eligible;
    const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
    state.page = Math.min(state.page, pages);
    const start = (state.page - 1) * PAGE_SIZE;
    const displayedKeys = new Set(ranking.displayed.map((flow) => flow.key));
    $("[data-ig-table]").innerHTML = rows.length ? `<div class="infographic-editor__table-scroll"><table><caption class="visually-hidden">All resolved flows, largest first</caption><thead><tr><th scope="col">#</th><th scope="col">Flow</th><th scope="col">Category</th><th scope="col" class="is-number">Weight (${escape(resolved.unit)})</th><th scope="col" class="is-number">Rows</th></tr></thead><tbody>${rows.slice(start, start + PAGE_SIZE).map((flow, index) => `<tr class="${flow.key === state.selectedKey ? "is-selected" : ""}${displayedKeys.has(flow.key) ? "" : " is-muted"}"><td>${start + index + 1}</td><td>${displayedKeys.has(flow.key) ? `<button type="button" class="link-button" data-ig-select="${escape(flow.key)}" aria-pressed="${flow.key === state.selectedKey}">${escape(flowLabel(flow))}</button>` : `${escape(flowLabel(flow))} <small>(not drawn)</small>`}</td><td>${escape(flow.category || "—")}</td><td class="is-number">${escape(formatValue(flow.weight))}</td><td class="is-number">${flow.rowCount}</td></tr>`).join("")}</tbody></table></div><div class="infographic-editor__pager"><button type="button" data-ig-page="-1"${state.page <= 1 ? " disabled" : ""}>Previous</button><span>Page ${state.page} of ${pages}</span><button type="button" data-ig-page="1"${state.page >= pages ? " disabled" : ""}>Next</button></div>` : `<p class="form-note">No resolved flows.</p>`;
  }

  function renderDiagnostics() {
    const { resolved } = state.model;
    const rows = resolved.diagnostics;
    $("[data-ig-diagnostics-count]").textContent = rows.length ? `${rows.length}` : "none";
    const summary = resolved.summary;
    const excluded = summary.excludedRows ? `<p class="form-note">${summary.excludedRows} excluded row${summary.excludedRows === 1 ? "" : "s"}${summary.excludedWeight > 0 ? ` carrying ${summary.excludedWeightComplete ? "" : "at least "}${escape(formatValue(summary.excludedWeight, resolved.unit))}` : ""}; ${summary.zeroRows} zero-weight row${summary.zeroRows === 1 ? "" : "s"} (valid, but nothing to draw).</p>` : "";
    $("[data-ig-diagnostics]").innerHTML = rows.length ? `${excluded}<div class="infographic-editor__table-scroll"><table><thead><tr><th scope="col">Row</th><th scope="col">Reason</th><th scope="col">Origin</th><th scope="col">Destination</th><th scope="col" class="is-number">Weight</th></tr></thead><tbody>${rows.slice(0, 200).map((row) => `<tr><td>${row.index + 1}</td><td>${escape(EXCLUSION_REASONS[row.reason] || row.reason)}</td><td>${escape(row.origin || "—")}</td><td>${escape(row.destination || "—")}</td><td class="is-number">${row.weight === null ? escape(row.rawWeight === null ? "missing" : `“${row.rawWeight}”`) : escape(formatValue(row.weight))}</td></tr>`).join("")}</tbody></table></div>${rows.length > 200 ? `<p class="form-note">First 200 of ${rows.length} rows.</p>` : ""}` : `<p class="form-note">Every row resolved.</p>`;
  }

  // ---- actions
  function standaloneSvg() {
    const geo = state.geoModules ? flowMapGeo(state.geoModules, state.recipe.design.projection) : null;
    const { svg, width, height } = renderFlowMapSvg(state.model, { geo, selectedKey: null });
    return { svg: `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`, width, height };
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportSvg() {
    if (!state.model) return;
    download(new Blob([standaloneSvg().svg], { type: "image/svg+xml" }), `${slug(state.recipe.title)}.svg`);
    host.toast("SVG exported.");
  }

  async function exportPng() {
    if (!state.model) return;
    const { svg, width, height } = standaloneSvg();
    const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
    try {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("The graphic could not be rasterized.")); image.src = url; });
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const context = canvas.getContext("2d");
      context.scale(scale, scale);
      context.drawImage(image, 0, 0, width, height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("The PNG could not be created.");
      download(blob, `${slug(state.recipe.title)}.png`);
      host.toast("PNG exported.");
    } catch (error) {
      host.error(error.message);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function copyRecipe() {
    const text = JSON.stringify(state.recipe, null, 2);
    try { await navigator.clipboard.writeText(text); host.toast("Recipe copied as JSON."); }
    catch { host.error("The clipboard is not available here."); }
  }

  function play() {
    const svg = $("[data-ig-canvas] svg");
    if (!svg) return;
    if (globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { host.toast("Reduced motion is on, so the complete map stays in place."); return; }
    svg.classList.remove("is-playing");
    void svg.getBoundingClientRect();
    svg.classList.add("is-playing");
    const count = state.model?.ranking.displayedCount || 0;
    clearTimeout(state.playTimer);
    state.playTimer = setTimeout(() => svg.classList.remove("is-playing"), count * 90 + 600);
  }

  function zoomToEndpoints() {
    const flow = selectedFlow();
    if (!flow) return;
    const extent = endpointExtent([flow.origin, flow.destination], 3);
    const east = extent.crossesAntimeridian ? extent.xmax + 360 : extent.xmax;
    Promise.resolve(mapController.setView({ bounds: [extent.xmin, extent.ymin, east, extent.ymax] }, { padding: 40 })).catch(() => host.error("The map could not zoom to these endpoints."));
  }

  // ---- events
  let pending = null;
  const schedule = (requery) => {
    clearTimeout(pending);
    pending = setTimeout(() => { readInspector(); if (requery) void queryRows(); else render(); }, requery ? 250 : 120);
  };
  root.addEventListener("input", (event) => {
    const target = event.target;
    if (target.matches("[data-ig-source]")) return;
    if (target.matches('[name="ig-mode"]')) { readInspector(); syncModeVisibility(); if (state.source === BEVERAGE_FIXTURE_ID) render(); else void queryRows(); return; }
    const queried = ["scope", "origin-id", "destination-id", "origin-lon", "origin-lat", "destination-lon", "destination-lat", "weight", "category", "period"].includes(target.dataset.ig);
    schedule(queried && state.source !== BEVERAGE_FIXTURE_ID);
  });
  root.addEventListener("change", (event) => {
    // Every other control reports through "input"; only the source switch is handled here.
    if (event.target.matches("[data-ig-source]")) { state.source = event.target.value; void loadSource(); }
  });
  root.addEventListener("click", (event) => {
    const selectButton = event.target.closest("[data-ig-select]");
    if (selectButton) { select(selectButton.dataset.igSelect); return; }
    const mark = event.target.closest("[data-ig-canvas] [data-flow-key]");
    if (mark) { select(mark.dataset.flowKey === state.selectedKey ? null : mark.dataset.flowKey); return; }
    const page = event.target.closest("[data-ig-page]");
    if (page) { state.page += Number(page.dataset.igPage); renderTable(); return; }
    if (event.target.closest("[data-ig-clear]")) { select(null); return; }
    if (event.target.closest("[data-ig-zoom]")) { zoomToEndpoints(); return; }
    if (event.target.closest("[data-ig-refresh]")) { void queryRows(); }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.selectedKey) { event.stopPropagation(); event.preventDefault(); select(null); }
  });

  await loadSource();
  return { state, render };
}

// ---------------------------------------------------------------- markup

function shellMarkup(layers, source) {
  return `<div class="infographic-editor" data-infographic>
    <aside class="infographic-editor__inspector" aria-label="Infographic settings">
      <label class="field"><span>Data</span><select data-ig-source><option value="${BEVERAGE_FIXTURE_ID}"${source === BEVERAGE_FIXTURE_ID ? " selected" : ""}>${escape(BEVERAGE_FIXTURE_NAME)}</option>${layers.map((layer) => `<option value="${escape(layer.uid)}"${layer.uid === source ? " selected" : ""}>${escape(layer.title || layer.uid)}</option>`).join("")}</select></label>
      <label class="field"><span>Template</span><select data-ig-template><option value="flow-map" selected>Flow Map</option><option disabled>Ranked Geography (coming next)</option></select></label>
      <details open><summary>Data</summary><div data-ig-data></div><div data-ig-period-choice hidden></div></details>
      <details open><summary>Design</summary><div data-ig-design></div><div data-ig-categories></div></details>
      <details><summary>Annotations</summary><p class="form-note">Up to three notes, each attached to one flow by its key, so a changed rank cannot move a note.</p><div data-ig-annotations></div></details>
    </aside>
    <section class="infographic-editor__preview" aria-label="Preview">
      <p class="infographic-editor__status" data-ig-status role="status"></p>
      <div class="infographic-editor__canvas" data-ig-canvas></div>
      <div class="infographic-editor__selection"><p data-ig-detail aria-live="polite"></p><div><button type="button" data-ig-clear disabled>Clear selection</button><button type="button" data-ig-zoom disabled>Zoom map to endpoints</button></div></div>
      <details open><summary>Flows table</summary><div data-ig-table></div></details>
      <details><summary>Diagnostics (<span data-ig-diagnostics-count>none</span>)</summary><div data-ig-diagnostics></div></details>
    </section>
  </div>`;
}

function fieldOptions(fields, selected, { numeric = false, allowNone = false, noneLabel = "None" } = {}) {
  const list = fields.filter((field) => !["geometry", "esriFieldTypeGeometry"].includes(field.type) && (!numeric || ["integer", "double", "single", "small-integer", "long", "big-integer", "number", "esriFieldTypeInteger", "esriFieldTypeDouble", "esriFieldTypeSingle", "esriFieldTypeSmallInteger"].includes(field.type)));
  return `${allowNone ? `<option value="">${escape(noneLabel)}</option>` : `<option value="">Choose a field…</option>`}${list.map((field) => `<option value="${escape(field.name)}"${field.name === selected ? " selected" : ""}>${escape(fieldLabel(field))}</option>`).join("")}`;
}

function dataMarkup(state) {
  const { recipe, fields, source } = state;
  const { bindings, query } = recipe;
  const isFixture = source === BEVERAGE_FIXTURE_ID;
  const scopes = [["all", "All records"], ["filtered", "Current filters"], ["extent", "Map extent"], ["selected", "Selected records"]];
  return `<div class="field-grid">
    <label class="field"><span>Scope</span><select data-ig="scope"${isFixture ? " disabled" : ""}>${scopes.map(([id, label]) => `<option value="${id}"${query.scope.type === id ? " selected" : ""}${id === "selected" ? " disabled" : ""}>${label}${id === "selected" ? " (not yet)" : ""}</option>`).join("")}</select><small>${isFixture ? "The demo is a bundled table." : "Map extent keeps a flow when either endpoint is in view. <button type=\"button\" class=\"link-button\" data-ig-refresh>Refresh</button>"}</small></label>
    <fieldset class="field infographic-editor__mode"><legend>Endpoints from</legend><label><input type="radio" name="ig-mode" value="ids"${bindings.mode === "ids" ? " checked" : ""}> Country codes</label><label><input type="radio" name="ig-mode" value="coordinates"${bindings.mode === "coordinates" ? " checked" : ""}> Coordinates</label></fieldset>
  </div>
  <div class="field-grid">
    <label class="field"><span><span data-ig-for-mode="ids">Origin ID</span><span data-ig-for-mode="coordinates">Origin name (optional)</span></span><select data-ig="origin-id">${fieldOptions(fields, bindings.origin.idField, { allowNone: bindings.mode === "coordinates" })}</select></label>
    <label class="field"><span><span data-ig-for-mode="ids">Destination ID</span><span data-ig-for-mode="coordinates">Destination name (optional)</span></span><select data-ig="destination-id">${fieldOptions(fields, bindings.destination.idField, { allowNone: bindings.mode === "coordinates" })}</select></label>
  </div>
  <p class="form-note" data-ig-for-mode="ids">IDs resolve against <strong>Country points v1</strong>: ISO 3166-1 alpha-3 codes for about 165 countries, one approximate representative point each. It does not cover every code (most small territories are missing); unmatched codes are listed in Diagnostics.</p>
  <div class="field-grid" data-ig-for-mode="coordinates">
    <label class="field"><span>Origin longitude</span><select data-ig="origin-lon">${fieldOptions(fields, bindings.origin.lonField, { numeric: true })}</select></label>
    <label class="field"><span>Origin latitude</span><select data-ig="origin-lat">${fieldOptions(fields, bindings.origin.latField, { numeric: true })}</select></label>
    <label class="field"><span>Destination longitude</span><select data-ig="destination-lon">${fieldOptions(fields, bindings.destination.lonField, { numeric: true })}</select></label>
    <label class="field"><span>Destination latitude</span><select data-ig="destination-lat">${fieldOptions(fields, bindings.destination.latField, { numeric: true })}</select></label>
  </div>
  <p class="form-note" data-ig-for-mode="coordinates">Coordinates must be WGS84 longitude and latitude in degrees.</p>
  <div class="field-grid">
    <label class="field"><span>Weight</span><select data-ig="weight">${fieldOptions(fields, bindings.weight.field, { numeric: true })}</select></label>
    <label class="field"><span>Unit (required)</span><input type="text" data-ig="unit" maxlength="40" value="${escape(bindings.weight.unit)}" placeholder="t, trips, USD" required></label>
    <label class="field"><span>Category</span><select data-ig="category">${fieldOptions(fields, bindings.categoryField, { allowNone: true })}</select></label>
    <label class="field"><span>Period</span><select data-ig="period">${fieldOptions(fields, bindings.periodField, { allowNone: true })}</select></label>
  </div>
  <p class="form-note">Duplicate origin–destination rows are summed within a category; reverse pairs stay separate. Suggested fields are a starting point: check each one.</p>`;
}

function designMarkup(recipe) {
  const { design } = recipe;
  const option = (value, label, selected) => `<option value="${value}"${value === selected ? " selected" : ""}>${label}</option>`;
  return `<label class="field"><span>Headline</span><input type="text" data-ig="title" maxlength="160" value="${escape(recipe.title)}"></label>
  <label class="field"><span>Explanation</span><textarea data-ig="subtitle" rows="2" maxlength="400">${escape(recipe.subtitle)}</textarea></label>
  <div class="field-grid">
    <label class="field"><span>Layout</span><select data-ig="layout">${option("wide", "Wide (16:9)", design.layout)}${option("square", "Square", design.layout)}${option("portrait", "Portrait", design.layout)}</select></label>
    <label class="field"><span>Theme</span><select data-ig="theme">${option("editorial-light", "Editorial light", design.theme)}${option("editorial-dark", "Editorial dark", design.theme)}</select></label>
    <label class="field"><span>Projection</span><select data-ig="projection">${option("world", "World (Equal Earth)", design.projection)}${option("regional", "Regional (Mercator, fitted)", design.projection)}</select></label>
    <label class="field"><span>Top flows</span><input type="number" data-ig="top-n" min="1" max="${FLOW_MAP_MAX_LINKS}" value="${design.topN}"><small>At most ${FLOW_MAP_MAX_LINKS} ribbons.</small></label>
  </div>`;
}
