import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {SETTINGS_SECTIONS} from "../lib/settings-navigation";

const settingsSource = readFileSync(new URL("../components/settings-panel.tsx", import.meta.url), "utf8");

function headingIdsInTab(source: string, tab: string) {
  const tabStart = source.indexOf(`<TabsContent value="${tab}"`);
  assert.ok(tabStart >= 0, `${tab} tab exists`);
  const tabEnd = source.indexOf("</TabsContent>", tabStart);
  return [...source.slice(tabStart, tabEnd).matchAll(/id="(settings-[^"]+)"/g)].map((item) => item[1]);
}

test("settings subsection links match the heading order in each tab", () => {
  const sections = Object.fromEntries(Object.entries(SETTINGS_SECTIONS).map(([tab, items]) => [tab, items.map(item => item.id)]));
  assert.deepEqual(sections.general, [
    "settings-subagent-model",
    "settings-token-compression",
    "settings-notifications",
    "settings-voice-input",
    "settings-dictionary",
    "settings-browser",
    "settings-browser-storage",
    "settings-session",
    "settings-links",
  ]);
  for (const tab of Object.keys(sections)) {
    assert.deepEqual(headingIdsInTab(settingsSource, tab), sections[tab], tab);
  }
});

test("Devices install step can show macOS and Linux desktop downloads", () => {
  assert.match(settingsSource, /setRemoteInstallerUrls\(data\.installerUrls/);
  assert.match(settingsSource, /Download \{installer\.label\}/);
  assert.match(settingsSource, /Drag the app into Applications/);
  assert.match(settingsSource, /Is it saying .damaged/);
  assert.match(settingsSource, /xattr -cr/);
  assert.match(settingsSource, /desktop-permissions/);
  assert.match(settingsSource, /OS permission check/);
  assert.match(settingsSource, /Grant on Mac/);
});

test("General settings end with external Website and GitHub links", () => {
  const general = settingsSource.slice(
    settingsSource.indexOf('<TabsContent value="general"'),
    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="general"')),
  );
  assert.ok(general.indexOf('id="settings-links"') > general.indexOf('id="settings-session"'));
  assert.match(general, /href="https:\/\/metis\.f1shy312\.com" target="_blank" rel="noopener noreferrer"/);
  assert.match(general, /href="https:\/\/github\.com\/f1shyondrugs\/metis-ai" target="_blank" rel="noopener noreferrer"/);
});

test("General settings no longer expose a Default model control", () => {
  assert.doesNotMatch(settingsSource, /Default model/);
  assert.doesNotMatch(settingsSource, /settings-default-model/);
  assert.doesNotMatch(settingsSource, /Choose the model used for new chats/);
});

test("remote client removal uses the shared confirmation dialog", () => {
  assert.doesNotMatch(settingsSource, /window\.confirm/);
  assert.match(settingsSource, /remoteClientDeleteTarget/);
  assert.match(settingsSource, /title="Remove remote client\?"/);
});

test("General settings expose the same browser controls as the sidebar", () => {
  const general = settingsSource.slice(
    settingsSource.indexOf('<TabsContent value="general"'),
    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="general"')),
  );
  assert.match(general, /id="settings-browser"/);
  assert.match(general, /<BrowserSettingsControls/);
  assert.match(general, /onChange=\{onBrowserSettingsChange\}/);
  assert.match(general, /browserViewportWidth=\{browserViewportWidth\}/);
  assert.match(general, /browserViewportHeight=\{browserViewportHeight\}/);
  assert.doesNotMatch(general, /Browser settings live in the browser tab/);
});

test("browser storage uses a dedicated manager instead of an inline origin list on General", () => {
  const general = settingsSource.slice(
    settingsSource.indexOf('<TabsContent value="general"'),
    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="general"')),
  );
  assert.match(general, /id="settings-browser-storage"/);
  assert.match(general, /setSettingsPane\("browser-storage"\)/);
  assert.doesNotMatch(general, /browserStorage\.map/);
  assert.doesNotMatch(general, /filteredBrowserStorage\.map/);
  assert.match(settingsSource, /data-slot="browser-storage-manager"/);
  assert.match(settingsSource, /filteredBrowserStorage\.map/);
  assert.match(settingsSource, /placeholder="Search websites"/);
  assert.match(settingsSource, /"settings-browser-storage": "browser-storage"/);
  assert.match(settingsSource, /const pane = SETTINGS_SECTION_TO_PANE\[item\.id\];/);
});

test("Models and Agent pack dense features behind settings tiles", () => {
  const models = headingIdsInTab(settingsSource, "models");
  const agent = headingIdsInTab(settingsSource, "agent");
  assert.deepEqual(models, ["settings-usage", "settings-providers", "settings-versions"]);
  assert.deepEqual(agent, ["settings-agent-runtime", "settings-skills", "settings-modes", "settings-mcp", "settings-memories", "settings-agent-rules"]);
  assert.match(settingsSource, /data-settings-tile=\{id\}/);
  assert.match(settingsSource, /id=\"settings-providers\"/);
  assert.match(settingsSource, /id=\"settings-versions\"/);
  assert.match(settingsSource, /id=\"settings-skills\"/);
  assert.match(settingsSource, /setSettingsPane\("providers"\)/);
  assert.match(settingsSource, /setSettingsPane\("versions"\)/);
  assert.match(settingsSource, /setSettingsPane\("skills"\)/);
  assert.match(settingsSource, /slot="providers-manager"/);
  assert.match(settingsSource, /slot="versions-manager"/);
  assert.match(settingsSource, /slot="skills-manager"/);
  assert.match(settingsSource, /slot="modes-manager"/);
  assert.match(settingsSource, /slot="mcp-manager"/);
  assert.match(settingsSource, /slot="memories-manager"/);
  assert.match(settingsSource, /title="Agent Rules"/);
  assert.match(settingsSource, /Manage individual instructions for how the agent responds across your chats/);
  assert.match(settingsSource, /setSettingsPane\("agent-rules"\)/);
  assert.match(settingsSource, /data-slot=\{slot\}/);
  const modelsTab = settingsSource.slice(
    settingsSource.indexOf('<TabsContent value="models"'),
    settingsSource.indexOf("</TabsContent>", settingsSource.indexOf('<TabsContent value="models"')),
  );
  assert.match(modelsTab, /<PlanUsagePanel/);
  assert.doesNotMatch(modelsTab, /provider-connection-form/);
  assert.doesNotMatch(modelsTab, /<SkillsSettings/);
});

test("provider editing stays inside the Models settings tab and OAuth names can be saved without reconnecting", () => {
  const editStart = settingsSource.indexOf("function editProviderConnection");
  const editEnd = settingsSource.indexOf("async function saveProviderConnection", editStart);
  const editBlock = settingsSource.slice(editStart, editEnd);
  assert.match(editBlock, /onSettingsTabChange\("models"\)/);
  assert.doesNotMatch(editBlock, /onSettingsTabChange\("providers"\)/);

  const oauthControls = settingsSource.slice(
    settingsSource.indexOf('{providerDraft.authType === "oauth" ? ('),
    settingsSource.indexOf(') : (', settingsSource.indexOf('{providerDraft.authType === "oauth" ? (')),
  );
  assert.match(oauthControls, /Save changes/);
  assert.match(oauthControls, /saveProviderConnection/);
  assert.match(oauthControls, /Reconnect OAuth/);
});
