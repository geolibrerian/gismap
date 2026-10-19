import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { APP_GUIDE, DISPLAY_SETTINGS, searchGuide, validateDisplaySetting } from "../js/app-guide.js";
import { buildAssistantInstructions, createAssistantTools, ASSISTANT_TOOLS } from "../js/map-assistant.js";

const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
const ui = await readFile(new URL("../js/ui.js", import.meta.url), "utf8");
const decode = (text) => text.replace(/&amp;/g, "&");

test("every menu item the guide names is in the app", () => {
  for (const { path } of APP_GUIDE) {
    const [menu, items] = path.split(" → ");
    if (menu === "Side panel") {
      assert.ok(html.includes(`<span>${items.split(" (")[0]}</span>`), `${path}: no such panel`);
      continue;
    }
    assert.match(html, new RegExp(`class="menu__trigger"[^>]*>${menu} `), `${menu}: no such menu`);
    for (const item of items.replace(/ \(skins\)$/, "").split(" · ")) assert.ok(decode(html).includes(`>${item}`), `${path}: "${item}" is not in index.html`);
  }
});

test("every display setting the assistant may change is a Layout & display setting", () => {
  for (const [key, { label }] of Object.entries(DISPLAY_SETTINGS)) {
    assert.match(ui, new RegExp(`${key}:`), key);
    assert.ok(ui.includes(label), `${key}: "${label}" is not in the dialog`);
  }
});

test("a question about the selection outline finds Layout & display", () => {
  const [first] = searchGuide("when a polygon is selected I want just the outline of the selection, where do I adjust that?");
  assert.equal(first.where, "Map → Layout & display…");
  assert.match(first.what, /Outline only/);
});

test("display settings are checked before they change", () => {
  assert.deepEqual(validateDisplaySetting("highlightStyle", "outline"), { key: "highlightStyle", value: "outline" });
  assert.deepEqual(validateDisplaySetting("highlightEnabled", "false"), { key: "highlightEnabled", value: false });
  assert.ok(validateDisplaySetting("highlightStyle", "dotted") instanceof Error);
  assert.ok(validateDisplaySetting("highlightColor", "teal") instanceof Error);
  assert.ok(validateDisplaySetting("password", "x") instanceof Error);
});

test("the assistant knows the menus and can change a display setting", () => {
  assert.match(buildAssistantInstructions(), /Map: .*Layout & display…/);
  for (const name of ["app_help", "get_display_settings", "change_display_setting"]) assert.ok(ASSISTANT_TOOLS.some((tool) => tool.name === name), name);
  const changes = [];
  const tools = createAssistantTools({ api: {}, getDisplaySettings: () => ({ highlightStyle: "fill" }), setDisplaySetting: (key, value) => changes.push([key, value]) });
  assert.equal(tools.get_display_settings().highlightStyle, "fill");
  assert.deepEqual(tools.change_display_setting({ setting: "highlightStyle", value: "outline" }), { highlightStyle: "outline", where: "Map → Layout & display…" });
  assert.deepEqual(changes, [["highlightStyle", "outline"]]);
  assert.throws(() => tools.change_display_setting({ setting: "highlightStyle", value: "dotted" }), /not a value/);
  assert.equal(tools.app_help({ question: "selection outline" }).matches[0].where, "Map → Layout & display…");
});

test("the assistant switches modes and skins, saves, shares and downloads", async () => {
  const calls = [];
  const tools = createAssistantTools({ api: {}, setMode: (mode) => calls.push(["mode", mode]), setSkin: (skin) => calls.push(["skin", skin]), saveProject: (name) => (calls.push(["save", name]), name || "Untitled"), openShareMenu: () => calls.push(["share"]), download: async (format) => calls.push(["download", format]) });
  assert.deepEqual(tools.set_mode({ mode: "briefing" }), { mode: "briefing" });
  assert.throws(() => tools.set_mode({ mode: "slides" }), /Unknown mode/);
  assert.deepEqual(tools.set_skin({ skin: "Midnight" }), { skin: "dark-analytical", label: "Midnight" });
  assert.throws(() => tools.set_skin({ skin: "neon" }), /Unknown skin/);
  assert.deepEqual(tools.save_project({ name: "Fires" }), { saved: "Fires" });
  tools.open_share_menu();
  await tools.download({ format: "smart-image" });
  await assert.rejects(tools.download({ format: "docx" }), /Unknown format/);
  assert.deepEqual(calls, [["mode", "briefing"], ["skin", "dark-analytical"], ["save", "Fires"], ["share"], ["download", "smart-image"]]);
  assert.match(searchGuide("change the skin to midnight")[0].where, /skins/);
});
