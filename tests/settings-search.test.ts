import assert from "node:assert/strict";
import test from "node:test";
import {SETTINGS_SECTIONS, SETTINGS_TABS, searchSettings, settingsOverviewSections, settingsSearchEntries, visibleSettingsSections} from "../lib/settings-navigation";

test("every visible settings section and top-level tab is searchable with its navigation destination", () => {
  for (const isAdmin of [false, true]) {
    const entries = settingsSearchEntries(isAdmin);
    assert.equal(new Set(entries.map(entry => entry.id)).size, entries.length);
    for (const tab of SETTINGS_TABS) {
      if(tab.value !== "admin" || isAdmin) assert.ok(entries.some(entry => entry.id === tab.value && entry.tab === tab.value && !entry.sectionId));
      for (const section of visibleSettingsSections(tab.value, isAdmin)) {
        const result = searchSettings(entries, section.label).find(entry => entry.id === section.id);
        assert.ok(result, section.label);
        assert.equal(result.tab, tab.value);
        assert.equal(result.sectionId, section.id);
      }
    }
    assert.equal(entries.length, SETTINGS_TABS.length - (isAdmin ? 0 : 1) + Object.keys(SETTINGS_SECTIONS).flatMap(tab => visibleSettingsSections(tab, isAdmin)).length);
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
  assert.deepEqual(find("agent rules"), []);
  assert.ok(find("provider limits").includes("settings-agent-runtime"));
  assert.deepEqual(find("cookies sound"), []);
});

test("agent model and context settings have Agent destinations without duplicate General entries", () => {
  for (const isAdmin of [false, true]) {
    const entries = settingsSearchEntries(isAdmin);
    for (const [query, sectionId] of [
      ["standard model", "settings-subagent-model"],
      ["unteragent", "settings-subagent-model"],
      ["token compression", "settings-token-compression"],
      ["kompression kontext", "settings-token-compression"],
    ]) {
      const result = searchSettings(entries, query).find(entry => entry.id === sectionId);
      assert.ok(result, query);
      assert.equal(result.tab, "agent");
      assert.equal(result.category, "Agent");
      assert.equal(result.sectionId, sectionId);
      assert.equal(entries.filter(entry => entry.id === sectionId).length, 1);
      assert.ok(!visibleSettingsSections("general", isAdmin).some(section => section.id === sectionId));
    }
  }
});

test("runtime search retains previous Settings terms and exposes the new recovery label", () => {
  const entries = settingsSearchEntries(false);
  for (const query of ["Runtime & recovery", "agent settings", "agent einstellungen", "provider limits", "retry", "laufzeit", "fehlerbehandlung", "wiederholen"]) {
    const result = searchSettings(entries, query).find(entry => entry.id === "settings-agent-runtime");
    assert.ok(result, query);
    assert.equal(result.tab, "agent");
    assert.equal(result.label, "Runtime & recovery");
    assert.equal(result.sectionId, "settings-agent-runtime");
  }
});

test("nested dictionary and browser storage stay searchable at their direct destinations", () => {
  for (const isAdmin of [false, true]) {
    const entries = settingsSearchEntries(isAdmin);
    const overview = settingsOverviewSections("general", isAdmin);
    for (const [query, sectionId, parentSectionId] of [
      ["dictionary", "settings-dictionary", "settings-voice-input"],
      ["wörterbuch", "settings-dictionary", "settings-voice-input"],
      ["cookies", "settings-browser-storage", "settings-browser"],
      ["browser storage", "settings-browser-storage", "settings-browser"],
    ]) {
      const section = visibleSettingsSections("general", isAdmin).find(item => item.id === sectionId);
      assert.equal(section?.parentSectionId, parentSectionId);
      assert.ok(overview.some(item => item.id === parentSectionId));
      assert.ok(!overview.some(item => item.id === sectionId));
      const result = searchSettings(entries, query).find(entry => entry.id === sectionId);
      assert.ok(result, query);
      assert.equal(result.tab, "general");
      assert.equal(result.sectionId, sectionId);
    }
    assert.equal(searchSettings(entries, "voice input").find(entry => entry.id === "settings-voice-input")?.label, "Voice & dictionary");
  }
});

test("overview navigation preserves host-admin boundaries and valid parent destinations", () => {
  for (const isAdmin of [false, true]) {
    for (const tab of SETTINGS_TABS) {
      const sections = visibleSettingsSections(tab.value, isAdmin);
      assert.ok(settingsOverviewSections(tab.value, isAdmin).every(section =>
        sections.some(visible => visible.id === section.id) && !section.parentSectionId,
      ));
      for (const child of sections.filter(section => section.parentSectionId)) {
        const parent = sections.find(section => section.id === child.parentSectionId);
        assert.ok(parent, child.id);
        assert.ok(!parent.parentSectionId, child.id);
      }
    }
  }
  assert.deepEqual(settingsOverviewSections("admin", false), []);
  assert.deepEqual(settingsOverviewSections("chats", false).map(section => section.id), ["settings-archived", "settings-deleted", "settings-shared"]);
  assert.ok(settingsOverviewSections("admin", true).some(section => section.id === "settings-users"));
  assert.ok(settingsOverviewSections("admin", true).some(section => section.id === "settings-maintenance"));
  assert.deepEqual(settingsOverviewSections("missing-tab", false), []);
});

test("search respects host-admin visibility and calls the nonadmin area Chats", () => {
  const admin = settingsSearchEntries(true);
  const regular = settingsSearchEntries(false);
  assert.ok(searchSettings(admin, "users").some(entry => entry.id === "settings-users"));
  assert.ok(searchSettings(admin, "maintenance").some(entry => entry.id === "settings-maintenance"));
  assert.deepEqual(searchSettings(regular, "users"), []);
  assert.deepEqual(searchSettings(regular, "maintenance"), []);
  assert.equal(regular.find(entry => entry.id === "admin"), undefined);
  assert.equal(regular.find(entry => entry.id === "chats")?.label, "Chats");
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
