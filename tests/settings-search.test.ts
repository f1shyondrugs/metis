import assert from "node:assert/strict";
import test from "node:test";
import {SETTINGS_SECTIONS, SETTINGS_TABS, searchSettings, settingsSearchEntries, visibleSettingsSections} from "../lib/settings-navigation";

test("every visible settings section and top-level tab is searchable with its navigation destination", () => {
  for (const isAdmin of [false, true]) {
    const entries = settingsSearchEntries(isAdmin);
    assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
    for (const tab of SETTINGS_TABS) {
      assert.ok(entries.some(entry => entry.id === tab.value && entry.tab === tab.value && !entry.sectionId));
      for (const section of visibleSettingsSections(tab.value, isAdmin)) {
        const result = searchSettings(entries, section.label).find(entry => entry.id === section.id);
        assert.ok(result, section.label);
        assert.equal(result.tab, tab.value);
        assert.equal(result.sectionId, section.id);
      }
    }
    assert.equal(entries.length, SETTINGS_TABS.length + Object.keys(SETTINGS_SECTIONS).flatMap(tab => visibleSettingsSections(tab, isAdmin)).length);
  }
});

test("search matches labels, categories, keywords and multiple words regardless of case or accents", () => {
  const entries = settingsSearchEntries(true);
  const find = (query: string) => searchSettings(entries, query).map(entry => entry.id);
  assert.equal(find("  bRoWsEr StOrAgE ")[0], "settings-browser-storage");
  assert.ok(find("cookies").includes("settings-browser-storage"));
  assert.ok(find("Sound").includes("settings-notifications"));
  assert.ok(find("BENACHRICHTIGUNGEN").includes("settings-notifications"));
  assert.ok(find("laufzeit").includes("settings-agent-runtime"));
  assert.ok(find("gerate").includes("settings-remote-clients"));
  assert.ok(find("agent rules").includes("settings-agent-rules"));
  assert.ok(find("provider limits").includes("settings-agent-runtime"));
  assert.deepEqual(find("cookies sound"), []);
});

test("search respects host-admin visibility and calls the nonadmin area Chats", () => {
  const admin = settingsSearchEntries(true);
  const regular = settingsSearchEntries(false);
  assert.ok(searchSettings(admin, "users").some(entry => entry.id === "settings-users"));
  assert.ok(searchSettings(admin, "maintenance").some(entry => entry.id === "settings-maintenance"));
  assert.deepEqual(searchSettings(regular, "users"), []);
  assert.deepEqual(searchSettings(regular, "maintenance"), []);
  assert.equal(regular.find(entry => entry.id === "admin")?.label, "Chats");
  assert.equal(regular.find(entry => entry.id === "settings-archived")?.category, "Chats");
  assert.ok(searchSettings(regular, "archived").some(entry => entry.id === "settings-archived"));
});

test("blank and unmatched searches return no results without mutating the shared index", () => {
  const entries = settingsSearchEntries(true);
  const before = structuredClone(entries);
  for (const query of ["", "  \n\t", "no-setting-with-this-name"]) assert.deepEqual(searchSettings(entries, query), []);
  searchSettings(entries, "browser");
  assert.deepEqual(entries, before);
});
