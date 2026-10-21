// One attribute filter builder for every place that filters features: Briefing,
// the Dataset explorer and the layer filter dialog. It edits conditions
// ({ field, op, value, value2 }) and Match all/any; js/briefing-conditions.js
// turns them into filters and js/filter-sql.js into a where clause.
import { fieldKind } from "./presentation-query.js?v=0.30.0";
import { conditionComplete, conditionLabel, defaultOperator, operatorsFor } from "./briefing-conditions.js?v=0.1.0";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const NO_VALUE = new Set(["is_null", "is_not_null"]);
let builderCount = 0;

/**
 * host: the element to fill. fields: [{ name, alias, type }].
 * valuesFor(name): suggestions for text fields, [{ value, label?, count? }] or a promise of them.
 * onChange({ conditions, logic }): after every edit that changes the filter.
 */
export function createFilterBuilder({ host, fields = [], conditions = [], logic = "and", valuesFor = () => [], onChange = () => {}, maxConditions = 10, addLabel = "Add condition" } = {}) {
  const id = ++builderCount;
  const usable = fields.filter((field) => field?.name);
  const kindOf = (name) => fieldKind(usable.find((field) => field.name === name));
  const aliasOf = (name) => usable.find((field) => field.name === name)?.alias || name;
  const state = { conditions: conditions.map((condition) => ({ ...condition })), logic: logic === "or" ? "or" : "and" };
  const suggestions = new Map();
  const emit = () => onChange({ conditions: state.conditions.map((condition) => ({ ...condition })), logic: state.logic });

  // A condition may name a field the list leaves out (an object ID, say): keep it selectable.
  const fieldOptions = (selected) => `${selected && !usable.some((field) => field.name === selected) ? `<option value="${escapeHtml(selected)}" selected>${escapeHtml(selected)}</option>` : ""}${usable.map((field) => `<option value="${escapeHtml(field.name)}"${field.name === selected ? " selected" : ""}>${escapeHtml(field.alias || field.name)}</option>`).join("")}`;
  const rowHtml = (condition, index) => {
    const kind = kindOf(condition.field);
    const type = kind === "number" ? 'type="number" step="any" inputmode="decimal"' : kind === "date" ? 'type="date"' : `type="text" list="fb-${id}-values-${index}"`;
    const input = (key, label, value, placeholder) => `<input data-fb-${key}="${index}" aria-label="${label}" value="${escapeHtml(value ?? "")}" ${type} placeholder="${placeholder}">`;
    const values = NO_VALUE.has(condition.op) ? ""
      : condition.op === "between" ? `<span class="condition-builder__range">${input("value", `${aliasOf(condition.field)} from`, condition.value, "From")}<span aria-hidden="true">to</span>${input("value2", `${aliasOf(condition.field)} to`, condition.value2, "To")}</span>`
      : `${input("value", `${aliasOf(condition.field)} value`, condition.value, condition.op === "in" ? "A, B, C" : "Value")}${kind === "text" ? `<datalist id="fb-${id}-values-${index}"></datalist>` : ""}`;
    const complete = conditionComplete(condition, kind);
    return `<li class="condition-builder__row${complete ? "" : " is-incomplete"}" data-fb-row="${index}">
      <select data-fb-field="${index}" aria-label="Field">${fieldOptions(condition.field)}</select>
      <select data-fb-op="${index}" aria-label="Condition">${operatorsFor(kind).map(([op, label]) => `<option value="${op}"${op === condition.op ? " selected" : ""}>${label}</option>`).join("")}</select>
      <span class="condition-builder__values">${values}</span>
      <button type="button" data-fb-remove="${index}" aria-label="Remove ${escapeHtml(complete ? conditionLabel(condition, kind, aliasOf(condition.field)) : "condition")}">×</button>
    </li>`;
  };

  // Suggestions are looked up once per field, then reused for every row on it.
  const fillSuggestions = async (index) => {
    const condition = state.conditions[index];
    const list = host.querySelector(`#fb-${id}-values-${index}`);
    if (!list || !condition) return;
    if (!suggestions.has(condition.field)) suggestions.set(condition.field, Promise.resolve(valuesFor(condition.field)).catch(() => []));
    const values = await suggestions.get(condition.field);
    if (state.conditions[index]?.field !== condition.field || !host.contains(list)) return;
    list.innerHTML = (values || []).slice(0, 200).map((item) => {
      const value = typeof item === "object" ? item.value : item;
      const label = typeof item === "object" ? [item.label && String(item.label) !== String(value) ? item.label : "", Number.isFinite(item.count) ? `${item.count.toLocaleString()}` : ""].filter(Boolean).join(" · ") : "";
      return `<option value="${escapeHtml(value)}"${label ? ` label="${escapeHtml(label)}"` : ""}></option>`;
    }).join("");
  };

  function render() {
    const rows = state.conditions.map(rowHtml).join("");
    host.innerHTML = `<div class="condition-builder" data-fb>
      ${state.conditions.length > 1 ? `<label class="condition-builder__logic">Match <select data-fb-logic aria-label="Match all or any conditions"><option value="and"${state.logic === "and" ? " selected" : ""}>all</option><option value="or"${state.logic === "or" ? " selected" : ""}>any</option></select> of these</label>` : ""}
      ${rows ? `<ol class="condition-builder__rows">${rows}</ol>` : ""}
      ${state.conditions.length < maxConditions && usable.length ? `<button type="button" class="condition-builder__add" data-fb-add>+ ${escapeHtml(addLabel)}</button>` : ""}
    </div>`;
    state.conditions.forEach((condition, index) => { if (kindOf(condition.field) === "text") void fillSuggestions(index); });
  }

  const changeAt = (index, patch, { rerender = false } = {}) => {
    const condition = state.conditions[index];
    if (!condition) return;
    const before = conditionComplete(condition, kindOf(condition.field));
    Object.assign(condition, patch);
    if (rerender) render();
    else host.querySelector(`[data-fb-row="${index}"]`)?.classList.toggle("is-incomplete", !conditionComplete(condition, kindOf(condition.field)));
    // Half-filled rows do not filter, so they only matter once they become complete or stop being so.
    if (before || conditionComplete(condition, kindOf(condition.field))) emit();
  };

  const onEvent = (event) => {
    const target = event.target;
    const index = (key) => Number(target.dataset[key]);
    if (event.type === "click") {
      if (target.closest("[data-fb-add]")) {
        const field = usable[0].name;
        state.conditions.push({ field, op: defaultOperator(kindOf(field)), value: "" });
        render();
        host.querySelector(`[data-fb-field="${state.conditions.length - 1}"]`)?.focus();
        return;
      }
      const remove = target.closest("[data-fb-remove]");
      if (remove) {
        const [removed] = state.conditions.splice(Number(remove.dataset.fbRemove), 1);
        render();
        if (removed && conditionComplete(removed, kindOf(removed.field))) emit();
      }
      return;
    }
    if (target.matches("[data-fb-logic]")) { state.logic = target.value; emit(); return; }
    if (target.matches("[data-fb-field]")) { changeAt(index("fbField"), { field: target.value, op: defaultOperator(kindOf(target.value)), value: "", value2: "" }, { rerender: true }); return; }
    if (target.matches("[data-fb-op]")) { changeAt(index("fbOp"), { op: target.value }, { rerender: true }); return; }
    if (target.matches("[data-fb-value]")) { changeAt(index("fbValue"), { value: target.value }); return; }
    if (target.matches("[data-fb-value2]")) changeAt(index("fbValue2"), { value2: target.value });
  };
  host.addEventListener("click", onEvent);
  host.addEventListener("change", onEvent);
  render();

  return {
    get conditions() { return state.conditions.map((condition) => ({ ...condition })); },
    get logic() { return state.logic; },
    /** Adds a first condition when there is none, for an "Add filter" button outside the builder. */
    addCondition(field = usable[0]?.name) {
      if (!field || state.conditions.length >= maxConditions) return;
      state.conditions.push({ field, op: defaultOperator(kindOf(field)), value: "" });
      render();
      host.querySelector(`[data-fb-field="${state.conditions.length - 1}"]`)?.focus();
    },
    destroy() { host.removeEventListener("click", onEvent); host.removeEventListener("change", onEvent); host.replaceChildren(); },
  };
}
