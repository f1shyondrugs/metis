import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import {SETTINGS_TABS, settingsOverviewSections, visibleSettingsSections, type SettingsSearchEntry} from "../lib/settings-navigation";

const settingsSource = readFileSync(new URL("../components/settings-panel.tsx", import.meta.url), "utf8");
const source = ts.createSourceFile("settings-panel.tsx", settingsSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function nodes<T extends ts.Node>(root: ts.Node, guard: (node: ts.Node) => node is T): T[] {
  const found: T[] = [];
  function visit(node: ts.Node) {
    if (guard(node)) found.push(node);
    node.forEachChild(visit);
  }
  visit(root);
  return found;
}

type Element = ts.JsxElement | ts.JsxSelfClosingElement;
function opening(element: Element) {
  return ts.isJsxElement(element) ? element.openingElement : element;
}
function elements(root: ts.Node, tag: string) {
  return nodes(root, (node): node is Element =>
    (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) && opening(node).tagName.getText(source) === tag);
}
function attribute(element: Element, name: string) {
  return opening(element).attributes.properties.find((item): item is ts.JsxAttribute =>
    ts.isJsxAttribute(item) && item.name.getText(source) === name)?.initializer;
}
function literalAttribute(element: Element, name: string) {
  const value = attribute(element, name);
  return value && ts.isStringLiteral(value) ? value.text : undefined;
}
function tabElement(tab: string) {
  const element = elements(source, "TabsContent").find(item => literalAttribute(item, "value") === tab);
  assert.ok(element, `${tab} tab exists`);
  return element;
}
function settingsLinksGroup() {
  const group = elements(source, "div").find(item => literalAttribute(item, "id") === "settings-links");
  assert.ok(group);
  return group;
}
function tabIds(tab: string) {
  const overview = tabElement(tab);
  const ids = nodes(overview, (node): node is Element =>
    ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node))
    .map(item => literalAttribute(item, "id"))
    .filter(id => id?.startsWith("settings-"));
  if (elements(overview, "SettingsExternalLinks").length) ids.push(literalAttribute(settingsLinksGroup(), "id"));
  return ids;
}
function paneNode(pane: string) {
  const branch = nodes(source, ts.isConditionalExpression).find(item =>
    nodes(item.condition, ts.isBinaryExpression).some(condition =>
      condition.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
      ts.isIdentifier(condition.left) && condition.left.text === "settingsPane" &&
      ts.isStringLiteral(condition.right) && condition.right.text === pane));
  assert.ok(branch, `${pane} detail exists`);
  return branch.whenTrue;
}
function isHostAdminGuarded(node: ts.Node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isConditionalExpression(parent) &&
      parent.whenTrue.pos <= node.pos && node.end <= parent.whenTrue.end &&
      nodes(parent.condition, ts.isIdentifier).some(item => item.text === "isHostAdmin")) return true;
  }
  return false;
}

test("overview sections preserve navigation order and each visible section has a destination", () => {
  const declaration = nodes(source, ts.isVariableDeclaration).find(item => item.name.getText(source) === "SETTINGS_SECTION_TO_PANE");
  assert.ok(declaration?.initializer && ts.isObjectLiteralExpression(declaration.initializer));
  const destinations = new Map(declaration.initializer.properties.filter(ts.isPropertyAssignment).map(item => {
    assert.ok(ts.isStringLiteral(item.name) && ts.isStringLiteral(item.initializer));
    return [item.name.text, item.initializer.text];
  }));
  for (const tab of SETTINGS_TABS) {
    const overview = tabElement(tab.value);
    assert.equal(elements(overview, "SettingsOverview").length, 1, tab.value);
    const expected = settingsOverviewSections(tab.value, true).map(item => item.id);
    assert.deepEqual(tabIds(tab.value).filter(id => expected.includes(id!)), expected, tab.value);
    for (const section of visibleSettingsSections(tab.value, true)) {
      const pane = destinations.get(section.id);
      if (pane) {
        paneNode(pane);
      } else {
        const directGroups = elements(overview, "div");
        if (elements(overview, "SettingsExternalLinks").length) directGroups.push(settingsLinksGroup());
        assert.ok(directGroups.some(item =>
          literalAttribute(item, "id") === section.id && literalAttribute(item, "role") === "group"),
        `${section.id} has a direct search/sidebar destination`);
      }
    }
    for (const row of elements(overview, "SettingsTile")) {
      const onOpen = attribute(row, "onOpen");
      assert.ok(onOpen && ts.isJsxExpression(onOpen) && onOpen.expression);
      assert.ok(nodes(onOpen.expression, ts.isCallExpression).some(call =>
        ts.isIdentifier(call.expression) && call.expression.text === "openSettingsPane"), literalAttribute(row, "id"));
    }
  }
});

test("General stays compact while agent model and compression controls live in Agent", () => {
  const general = tabIds("general");
  assert.ok(!general.includes("settings-subagent-model"));
  assert.ok(!general.includes("settings-token-compression"));
  for (const id of ["settings-subagent-model", "settings-token-compression"]) assert.ok(tabIds("agent").includes(id));
  for (const tag of ["Input", "Textarea", "Switch", "ModelPicker", "BrowserSettingsControls"]) {
    assert.equal(elements(tabElement("general"), tag).length, 0, `${tag} opens in a detail`);
  }
  const attachments = elements(tabElement("general"), "AttachmentSettings");
  assert.equal(attachments.length, 1);
  assert.ok(opening(attachments[0]).attributes.properties.some(item => ts.isJsxAttribute(item) && item.name.getText(source) === "summary"));
  assert.equal(elements(paneNode("attachments"), "AttachmentSettings").length, 1);
  assert.equal(elements(paneNode("subagent-model"), "ModelPicker").length, 1);
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

test("the shared Website and GitHub footer keeps safe direct destinations and stays outside mobile General", () => {
  assert.equal(tabIds("general").at(-1), "settings-links");
  const group = settingsLinksGroup();
  const generalFooter = elements(tabElement("general"), "SettingsExternalLinks");
  assert.equal(generalFooter.length, 1);
  const guard = generalFooter[0].parent;
  assert.ok(ts.isConditionalExpression(guard));
  assert.equal(guard.condition.getText(source), "!mobile");
  const mobileMenu = elements(source, "div").find(item => literalAttribute(item, "data-slot") === "settings-mobile-menu");
  assert.ok(mobileMenu);
  assert.equal(elements(mobileMenu, "SettingsExternalLinks").length, 1);
  assert.ok(elements(mobileMenu, "nav")[0].end < elements(mobileMenu, "SettingsExternalLinks")[0].pos, "links follow the category list");
  assert.equal(literalAttribute(group, "role"), "group");
  const links = elements(group, "a");
  assert.deepEqual(links.map(link => literalAttribute(link, "href")), [
    "https://metis.f1shy312.com",
    "https://github.com/f1shyondrugs/metis-ai",
  ]);
  for (const link of links) {
    assert.equal(literalAttribute(link, "target"), "_blank");
    assert.equal(literalAttribute(link, "rel"), "noopener noreferrer");
  }
});

function functionDeclaration(name: string) {
  const declaration = nodes(source, ts.isFunctionDeclaration).find(item => item.name?.text === name);
  assert.ok(declaration, name);
  return declaration;
}

type NavigationState = { tab: string; pane: string; menu: boolean; target: string | null; storageQuery: string };
type NavigationHandlers = {
  openSettingsCategory: (tab: string) => void;
  openSettingsPane: (pane: string, tab?: string) => void;
  backToSettings: (section: string) => void;
  backToSettingsMenu: () => void;
  openSettingsSearchResult: (entry: SettingsSearchEntry) => void;
};
function navigationHarness(mobile = true) {
  const state: NavigationState = { tab: "general", pane: "tab", menu: true, target: null, storageQuery: "old query" };
  const names = ["openSettingsCategory", "openSettingsPane", "backToSettings", "backToSettingsMenu", "openSettingsSearchResult"];
  const destinations = nodes(source, ts.isVariableDeclaration).find(item => item.name.getText(source) === "SETTINGS_SECTION_TO_PANE");
  assert.ok(destinations?.initializer);
  const compiled = ts.transpileModule(`
    const SETTINGS_SECTION_TO_PANE = ${destinations.initializer.getText(source)};
    let settingsTab = state.tab;
    const onSettingsTabChange = value => { settingsTab = value; state.tab = value; };
    const setMobileMenuOpen = value => { state.menu = value; };
    const setSettingsPane = value => { state.pane = value; };
    const setBrowserStorageQuery = value => { state.storageQuery = value; };
    const setSettingsSearchTarget = value => { state.target = value; };
    ${names.map(name => functionDeclaration(name).getText(source)).join("\n")}
    return { ${names.join(",")} };
  `, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const handlers = new Function("mobile", "state", compiled)(mobile, state) as NavigationHandlers;
  return { state, ...handlers };
}

test("mobile navigation preserves root, category, detail and focus-return levels", () => {
  const nav = navigationHarness();
  for (const tab of SETTINGS_TABS) {
    nav.openSettingsCategory(tab.value);
    assert.equal(nav.state.tab, tab.value);
    assert.equal(nav.state.menu, false);
    assert.equal(nav.state.pane, "tab");
    assert.equal(nav.state.target, "top");
    assert.equal(nav.state.storageQuery, "");
    nav.backToSettingsMenu();
    assert.equal(nav.state.menu, true);
    assert.equal(nav.state.target, `settings-category-${tab.value}`);
  }
  nav.openSettingsCategory("agent");
  nav.openSettingsPane("agent-settings");
  assert.equal(nav.state.pane, "agent-settings");
  assert.equal(nav.state.target, "pane");
  nav.backToSettings("settings-agent-runtime");
  assert.deepEqual({ menu: nav.state.menu, pane: nav.state.pane, target: nav.state.target },
    { menu: false, pane: "tab", target: "settings-agent-runtime" });
  nav.backToSettingsMenu();
  assert.equal(nav.state.target, "settings-category-agent");
  nav.openSettingsPane("notifications", "general");
  assert.equal(nav.state.menu, false);
  assert.equal(nav.state.tab, "general");
});

test("Security keeps the credential manager reachable from its overview and search", () => {
  const overview = tabElement("security");
  assert.equal(elements(overview, "SettingsTile").length, 1);
  assert.equal(elements(paneNode("credential-vault"), "SavedWebsiteLogins").length, 1);
  for (const mobile of [true, false]) {
    const nav = navigationHarness(mobile);
    nav.openSettingsCategory("security");
    nav.openSettingsPane("credential-vault");
    assert.deepEqual({ tab: nav.state.tab, menu: nav.state.menu, pane: nav.state.pane, target: nav.state.target },
      { tab: "security", menu: false, pane: "credential-vault", target: "pane" });
    nav.backToSettings("settings-credential-vault");
    assert.equal(nav.state.pane, "tab");
    assert.equal(nav.state.target, "settings-credential-vault");
    nav.openSettingsSearchResult({ id: "settings-credential-vault", sectionId: "settings-credential-vault", tab: "security", label: "Credential Vault", category: "Security" });
    assert.equal(nav.state.tab, "security");
    assert.equal(nav.state.pane, "credential-vault");
    assert.equal(nav.state.menu, false);
  }
});

test("mobile search opens categories and nested details while external-links search returns to the root", () => {
  const nav = navigationHarness();
  nav.openSettingsSearchResult({ id: "models", tab: "models", label: "Models", category: "Settings" });
  assert.deepEqual({ tab: nav.state.tab, menu: nav.state.menu, pane: nav.state.pane, target: nav.state.target },
    { tab: "models", menu: false, pane: "tab", target: "top" });
  nav.openSettingsSearchResult({ id: "settings-dictionary", sectionId: "settings-dictionary", tab: "general", label: "Dictionary", category: "General" });
  assert.equal(nav.state.pane, "dictionary");
  assert.equal(nav.state.menu, false);
  assert.equal(nav.state.target, "pane");
  const links = { id: "settings-links", sectionId: "settings-links", tab: "general", label: "Website & GitHub", category: "Settings" };
  nav.openSettingsSearchResult(links);
  assert.deepEqual({ menu: nav.state.menu, pane: nav.state.pane, target: nav.state.target },
    { menu: true, pane: "tab", target: "settings-links" });
  const desktop = navigationHarness(false);
  desktop.openSettingsCategory("agent");
  desktop.openSettingsSearchResult(links);
  assert.equal(desktop.state.tab, "general");
  assert.equal(desktop.state.menu, false);
  assert.equal(desktop.state.target, "settings-links");
});

test("mobile starts at the category menu except for a requested deep link and shares role-aware labels", () => {
  const initialState = nodes(source, ts.isVariableDeclaration).find(item =>
    ts.isArrayBindingPattern(item.name) && item.name.elements[0]?.getText(source) === "mobileMenuOpen");
  assert.ok(initialState?.initializer && ts.isCallExpression(initialState.initializer));
  const initialize = new Function("sectionRequest", `return ${initialState.initializer.arguments[0].getText(source)};`);
  assert.equal(initialize(null), true);
  assert.equal(initialize("settings-voice-input"), false);
  const labelSource = ts.transpileModule(`${functionDeclaration("settingsCategoryLabel").getText(source)}; return settingsCategoryLabel;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  const label = new Function(labelSource)() as (tab: typeof SETTINGS_TABS[number], admin: boolean, update: boolean) => string;
  for (const tab of SETTINGS_TABS) {
    assert.equal(label(tab, false, false), tab.value === "admin" ? "Chats" : tab.label);
    assert.equal(label(tab, true, false), tab.label);
  }
  assert.equal(label(SETTINGS_TABS.find(tab => tab.value === "updates")!, true, true), "Update Available");
  const root = elements(source, "div").find(item => literalAttribute(item, "data-slot") === "settings-mobile-menu");
  assert.ok(root);
  assert.ok(nodes(root, ts.isCallExpression).some(call =>
    ts.isPropertyAccessExpression(call.expression) && call.expression.getText(source) === "SETTINGS_TABS.map"));
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

test("Browser detail preserves the same controls and callbacks as the sidebar", () => {
  assert.ok(tabIds("general").includes("settings-browser"));
  const controls = elements(paneNode("browser"), "BrowserSettingsControls");
  assert.equal(controls.length, 1);
  for (const [prop, expression] of [
    ["onChange", "onBrowserSettingsChange"],
    ["browserEnabled", "browserEnabled"],
    ["browserRealtime", "browserRealtime"],
    ["browserFps", "browserFps"],
    ["browserViewportWidth", "browserViewportWidth"],
    ["browserViewportHeight", "browserViewportHeight"],
  ]) {
    const value = attribute(controls[0], prop);
    assert.ok(value && ts.isJsxExpression(value));
    assert.equal(value.expression?.getText(source), expression, prop);
  }
});

test("nested browser storage and dictionary retain direct managers without expanding General", () => {
  assert.ok(!tabIds("general").includes("settings-browser-storage"));
  assert.ok(!tabIds("general").includes("settings-dictionary"));
  assert.ok(elements(paneNode("browser"), "SettingsTile").some(item => literalAttribute(item, "id") === "settings-browser-storage"));
  assert.ok(elements(paneNode("voice"), "SettingsTile").some(item => literalAttribute(item, "id") === "settings-dictionary"));
  const storage = paneNode("browser-storage").getText(source);
  assert.match(storage, /data-slot="browser-storage-manager"/);
  assert.match(storage, /filteredBrowserStorage\.map/);
  assert.match(storage, /placeholder="Search websites"/);
  assert.equal(elements(paneNode("dictionary"), "VoiceDictionarySettings").length, 1);
});

test("Settings retain models, runtime and memories while extensions stay in Agent Hub", () => {
  assert.ok(tabIds("models").includes("settings-usage"));
  assert.ok(tabIds("models").includes("settings-providers"));
  assert.ok(tabIds("agent").includes("settings-agent-runtime"));
  assert.ok(tabIds("agent").includes("settings-memories"));
  for (const section of ["skills", "modes", "mcp", "agent-rules"]) assert.doesNotMatch(settingsSource, new RegExp('id="settings-' + section + '"'));
  assert.equal(elements(paneNode("usage"), "PlanUsagePanel").length, 1);
  assert.equal(elements(paneNode("agent-settings"), "AgentRuntimeSettings").length, 1);
  assert.equal(elements(paneNode("agent-settings"), "ProviderLimitSettings").length, 1);
  assert.equal(elements(paneNode("agent-settings"), "ProviderRetrySettings").length, 1);
});

test("Notifications have one shared detail for alerts, sound and delivery devices", () => {
  const notifications = paneNode("notifications");
  for (const tag of ["NotificationDeliverySettings", "RemoteNotificationSettings", "RemoteDeviceNotificationSwitch"]) {
    assert.equal(elements(notifications, tag).length, 1, tag);
    assert.equal(elements(paneNode("remote-clients"), tag).length, 0, `${tag} is centralized`);
  }
  const deviceLinks = elements(paneNode("remote-clients"), "SettingsTile");
  assert.ok(deviceLinks.some(item => literalAttribute(item, "title") === "Notifications"));
});

test("host-only admin rows and their detail panes remain guarded", () => {
  for (const [id, pane] of [["settings-users", "users"], ["settings-maintenance", "maintenance"]]) {
    const row = elements(tabElement("admin"), "SettingsTile").find(item => literalAttribute(item, "id") === id);
    assert.ok(row);
    assert.ok(isHostAdminGuarded(row), `${id} overview guard`);
    assert.ok(isHostAdminGuarded(paneNode(pane)), `${pane} detail guard`);
    assert.ok(!settingsOverviewSections("admin", false).some(section => section.id === id));
  }
  for (const pane of ["archived", "shared"]) assert.ok(!isHostAdminGuarded(paneNode(pane)), `${pane} remains available to normal accounts`);
});

test("provider editing stays in Models and OAuth names save without reconnecting", () => {
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
