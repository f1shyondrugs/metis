import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import {
  APPEARANCE_STORAGE_CONFIG,
  APPEARANCE_STORAGE_KEY,
  APPLIED_THEME_VARIABLES_ATTRIBUTE,
  LEGACY_APPEARANCE_STORAGE_KEY,
  MAX_APPEARANCE_STATE_BYTES,
  MAX_CUSTOM_THEMES,
  applyAppearanceTheme,
  createCustomTheme,
  createDefaultAppearanceState,
  deleteCustomTheme,
  getSelectedTheme,
  persistAppearanceState,
  readAppearanceState,
  readAppearanceStateForBootstrap,
  selectAppearanceTheme,
  updateCustomTheme,
  type AppearanceState,
} from "../lib/appearance-storage";
import { getThemePreset, normalizeTheme, type ThemeDefinition } from "../lib/appearance-theme";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    values,
    writes,
    getItem(key: string) { return values.get(key) ?? null; },
    setItem(key: string, value: string) { writes.push(key); values.set(key, value); },
  };
}

function theme(name = "Custom", variables: Record<string, string> = { "--background": "#123456" }): ThemeDefinition {
  return { format: "metis-theme", version: 1, name, mode: "dark", variables };
}

function stored(customThemes: unknown[], selected = "midnight", extra: Record<string, unknown> = {}) {
  return memoryStorage({
    [APPEARANCE_STORAGE_KEY]: JSON.stringify({ version: 1, selected, customThemes, ...extra }),
  });
}

function rootElement() {
  const properties = new Map<string, string>();
  const attributes = new Map<string, string>();
  const classes = new Set(["dark", "app-root"]);
  const root = {
    style: {
      colorScheme: "",
      setProperty(name: string, value: string) { properties.set(name, value); },
      removeProperty(name: string) { const old = properties.get(name); properties.delete(name); return old ?? ""; },
    },
    classList: {
      toggle(name: string, enabled: boolean) { if (enabled) classes.add(name); else classes.delete(name); return enabled; },
    },
    getAttribute(name: string) { return attributes.get(name) ?? null; },
    setAttribute(name: string, value: string) { attributes.set(name, value); },
  };
  return { root: root as unknown as HTMLElement, properties, attributes, classes, style: root.style };
}

test("empty and disabled browser storage fall back to Midnight without writes", () => {
  const storage = memoryStorage();
  assert.deepEqual(readAppearanceState(storage), createDefaultAppearanceState());
  assert.deepEqual(storage.writes, []);
  assert.deepEqual(readAppearanceState({ getItem() { throw new Error("Storage disabled"); } }), createDefaultAppearanceState());
});

test("legacy Midnight and Graphite choices migrate on the next successful save", () => {
  for (const id of ["metis", "midnight", "graphite"]) {
    const storage = memoryStorage({ [LEGACY_APPEARANCE_STORAGE_KEY]: id });
    const state = readAppearanceState(storage);
    assert.equal(state.selected, id);
    assert.deepEqual(storage.writes, []);
    persistAppearanceState(storage, state);
    assert.deepEqual(storage.writes, [APPEARANCE_STORAGE_KEY]);
    assert.equal(storage.values.get(LEGACY_APPEARANCE_STORAGE_KEY), id);
    assert.deepEqual(readAppearanceState(storage), state);
  }
});

test("custom definitions and the active choice survive save and reload independently", () => {
  const input = theme("  My theme  ");
  const first = createCustomTheme(createDefaultAppearanceState(), input, "custom-first");
  const second = createCustomTheme(first, theme("Second", { "--radius": "1rem" }), "custom-second");
  const state = selectAppearanceTheme(second, "graphite");
  const storage = memoryStorage();
  persistAppearanceState(storage, state);
  const restored = readAppearanceState(storage);
  assert.deepEqual(restored, state);
  assert.equal(restored.customThemes[0].theme.name, "My theme");
  assert.equal(input.name, "  My theme  ");
  assert.equal(getSelectedTheme(restored).name, getThemePreset("graphite")!.name);
  assert.equal(selectAppearanceTheme(restored, "custom-first").customThemes.length, 2);
  assert.equal(first.customThemes.length, 1);
});

test("corrupt canonical records recover a legacy choice; canonical valid records take precedence", () => {
  for (const json of ["{", "null", "[]", '{"version":2,"customThemes":[]}']) {
    const storage = memoryStorage({
      [APPEARANCE_STORAGE_KEY]: json,
      [LEGACY_APPEARANCE_STORAGE_KEY]: "graphite",
    });
    assert.equal(readAppearanceState(storage).selected, "graphite");
  }
  const storage = stored([], "unknown");
  storage.values.set(LEGACY_APPEARANCE_STORAGE_KEY, "graphite");
  assert.equal(readAppearanceState(storage).selected, "metis");
});

test("recovery retains valid themes while rejecting bad entries, duplicate IDs, and pollution", () => {
  const valid = { id: "custom-good", theme: theme("First") };
  const storage = stored([
    null,
    { id: "__proto__", theme: theme() },
    { id: "constructor", theme: theme() },
    { id: "graphite", theme: theme() },
    { id: "custom-invalid", theme: { ...theme(), version: 2 } },
    { id: "custom-bad-value", theme: theme("Bad", { "--background": "url(https://example.com)" }) },
    JSON.parse('{"id":"custom-pollution","theme":{"format":"metis-theme","version":1,"name":"Bad","mode":"dark","variables":{},"__proto__":{"polluted":true}}}'),
    valid,
    { id: "custom-good", theme: theme("Duplicate") },
    { id: "custom-other", theme: theme("Other") },
  ], "custom-good");
  const restored = readAppearanceState(storage);
  assert.equal(restored.selected, "custom-good");
  assert.deepEqual(restored.customThemes.map((item) => [item.id, item.theme.name]), [
    ["custom-good", "First"], ["custom-other", "Other"],
  ]);
  assert.equal((Object.prototype as Record<string, unknown>).polluted, undefined);
  storage.values.set(APPEARANCE_STORAGE_KEY, '{"version":1,"selected":"graphite","customThemes":[],"__proto__":{}}');
  assert.deepEqual(readAppearanceState(storage), createDefaultAppearanceState());
});

test("missing or rejected selected custom themes fall back without deleting surviving themes", () => {
  const restored = readAppearanceState(stored([
    { id: "custom-valid", theme: theme() },
    { id: "custom-broken", theme: {} },
  ], "custom-broken"));
  assert.equal(restored.selected, "metis");
  assert.equal(restored.customThemes.length, 1);
  assert.equal(getSelectedTheme({ ...restored, selected: "missing" }).name, "Metis");
});

test("bounded recovery and save reject oversized files, individual themes, and theme counts", () => {
  const entries = Array.from({ length: MAX_CUSTOM_THEMES + 3 }, (_, i) => ({ id: "custom-" + i, theme: theme() }));
  const restored = readAppearanceState(stored(entries, "custom-22"));
  assert.equal(restored.customThemes.length, MAX_CUSTOM_THEMES);
  assert.equal(restored.selected, "metis");
  assert.throws(() => createCustomTheme(restored, theme()), /up to 20/);
  const oversized = memoryStorage({
    [APPEARANCE_STORAGE_KEY]: " ".repeat(MAX_APPEARANCE_STATE_BYTES + 1),
    [LEGACY_APPEARANCE_STORAGE_KEY]: "graphite",
  });
  assert.equal(readAppearanceState(oversized).selected, "graphite");
  const unicode = stored([], "graphite", { padding: "é".repeat(MAX_APPEARANCE_STATE_BYTES / 2) });
  assert.equal(readAppearanceState(unicode).selected, "metis");
  const variables = Object.fromEntries(Array.from({ length: 80 }, (_, i) => ["--large-" + i, "x".repeat(3500)]));
  assert.throws(() => createCustomTheme(createDefaultAppearanceState(), theme("Too large", variables)), /256 KiB/);
});

test("aggregate storage limit fails before changing saved state", () => {
  const variables = Object.fromEntries(Array.from({ length: 60 }, (_, i) => ["--large-" + i, "x".repeat(3500)]));
  const first = createCustomTheme(createDefaultAppearanceState(), theme("One", variables), "custom-one");
  const second = createCustomTheme(first, theme("Two", variables), "custom-two");
  const storage = memoryStorage();
  persistAppearanceState(storage, second);
  const saved = storage.values.get(APPEARANCE_STORAGE_KEY);
  assert.throws(() => createCustomTheme(second, theme("Three", variables), "custom-three"), /512 KiB/);
  const oversized: AppearanceState = {
    ...second,
    customThemes: [...second.customThemes, { id: "custom-three", theme: theme("Three", variables) }],
  };
  assert.throws(() => persistAppearanceState(storage, oversized), /512 KiB/);
  assert.equal(storage.values.get(APPEARANCE_STORAGE_KEY), saved);
  assert.equal(storage.writes.length, 1);
});

test("quota and disabled-write failures propagate without mutating caller state", () => {
  const state = createCustomTheme(createDefaultAppearanceState(), theme(), "custom-unsaved");
  const before = JSON.stringify(state);
  const failure = new Error("QuotaExceededError");
  let writes = 0;
  assert.throws(() => persistAppearanceState({
    setItem() { writes += 1; throw failure; },
  }, state), (error) => error === failure);
  assert.equal(writes, 1);
  assert.equal(JSON.stringify(state), before);
});

test("save validates custom IDs and duplicates before any write", () => {
  const storage = memoryStorage();
  const initial = createDefaultAppearanceState();
  for (const id of ["midnight", "custom-", "custom-UPPER", "custom-a/b", "__proto__", "constructor"]) {
    assert.throws(() => createCustomTheme(initial, theme(), id), /ID/);
  }
  const state = createCustomTheme(initial, theme(), "custom-good");
  assert.throws(() => createCustomTheme(state, theme(), "custom-good"), /already exists/);
  assert.throws(() => persistAppearanceState(storage, {
    ...state, customThemes: [state.customThemes[0], state.customThemes[0]],
  }), /unique/);
  assert.throws(() => persistAppearanceState(storage, { ...state, selected: "missing" }), /does not exist/);
  assert.equal(storage.writes.length, 0);
});

test("selection and deletion are immutable and idempotent, with a safe active deletion fallback", () => {
  const first = createCustomTheme(createDefaultAppearanceState(), theme("One"), "custom-one");
  const second = createCustomTheme(first, theme("Two"), "custom-two");
  assert.equal(selectAppearanceTheme(second, "custom-two"), second);
  assert.equal(deleteCustomTheme(second, "custom-missing"), second);
  assert.throws(() => selectAppearanceTheme(second, "missing"), /does not exist/);
  assert.throws(() => deleteCustomTheme(second, "midnight"), /Built-in/);
  const removedInactive = deleteCustomTheme(second, "custom-one");
  assert.equal(removedInactive.selected, "custom-two");
  const removedActive = deleteCustomTheme(second, "custom-two");
  assert.equal(removedActive.selected, "metis");
  assert.deepEqual(removedActive.customThemes.map((item) => item.id), ["custom-one"]);
  assert.equal(second.customThemes.length, 2);
  const generated = createCustomTheme(createDefaultAppearanceState(), theme());
  assert.match(generated.selected, /^custom-[a-z0-9][a-z0-9-]*$/);
});

test("editing or renaming a saved theme works at the custom theme limit", () => {
  const entries = Array.from({ length: MAX_CUSTOM_THEMES }, (_, i) => ({ id: "custom-" + i, theme: theme() }));
  const state = readAppearanceState(stored(entries, "midnight"));
  const edited = updateCustomTheme(state, "custom-3", theme("Renamed", { "--radius": "2rem" }));
  assert.equal(edited.customThemes.length, MAX_CUSTOM_THEMES);
  assert.equal(edited.selected, "custom-3");
  assert.equal(getSelectedTheme(edited).name, "Renamed");
  assert.equal(getSelectedTheme(edited).variables["--radius"], "2rem");
  assert.equal(state.customThemes[3].theme.name, "Custom");
  assert.throws(() => updateCustomTheme(state, "custom-missing", theme()), /does not exist/);
  assert.throws(() => updateCustomTheme(state, "midnight", theme()), /does not exist/);
});

test("switching themes removes all previous overrides while preserving unrelated root styles", () => {
  const element = rootElement();
  element.properties.set("--outside-theme", "kept");
  element.properties.set("font-size", "17px");
  applyAppearanceTheme(element.root, theme("Custom", { "--custom-only": "red", "--background": "#112233" }), "custom-one");
  assert.equal(element.properties.get("--custom-only"), "red");
  assert.equal(element.attributes.get("data-surface"), "custom-one");
  assert.equal(element.style.colorScheme, "dark");
  const paper = getThemePreset("paper")!;
  applyAppearanceTheme(element.root, paper, paper.id);
  assert.equal(element.properties.has("--custom-only"), false);
  assert.equal(element.properties.get("--background"), paper.variables["--background"]);
  assert.equal(element.properties.get("--outside-theme"), "kept");
  assert.equal(element.properties.get("font-size"), "17px");
  assert.equal(element.classes.has("dark"), false);
  assert.equal(element.classes.has("app-root"), true);
  assert.equal(element.style.colorScheme, "light");
  const snapshot = [...element.properties];
  applyAppearanceTheme(element.root, paper, paper.id);
  assert.deepEqual([...element.properties], snapshot);
});

test("the hydrated application removes overrides owned by the pre-paint script", () => {
  const element = rootElement();
  element.properties.set("--boot-only", "red");
  element.properties.set("color", "blue");
  element.attributes.set(APPLIED_THEME_VARIABLES_ATTRIBUTE, JSON.stringify(["--boot-only", "color", "__proto__"]));
  applyAppearanceTheme(element.root, getThemePreset("midnight")!, "midnight");
  assert.equal(element.properties.has("--boot-only"), false);
  assert.equal(element.properties.get("color"), "blue");
  const names = JSON.parse(element.attributes.get(APPLIED_THEME_VARIABLES_ATTRIBUTE)!);
  assert.ok(names.includes("--background"));
  assert.ok(names.every((name: string) => name.startsWith("--")));
});

test("invalid themes fail validation before any DOM mutation", () => {
  const element = rootElement();
  assert.throws(() => applyAppearanceTheme(element.root, theme("Bad", { "--x": "red; color: white" }), "custom-bad"));
  assert.equal(element.properties.size, 0);
  assert.equal(element.attributes.size, 0);
});

test("pre-paint storage reader serializes without module dependencies", () => {
  const serializedReader = runInNewContext(
    "(" + readAppearanceStateForBootstrap.toString() + ")",
    { TextEncoder, Object, JSON },
  ) as typeof readAppearanceStateForBootstrap;
  const fixtures = [
    memoryStorage(),
    memoryStorage({ [LEGACY_APPEARANCE_STORAGE_KEY]: "graphite" }),
    stored([{ id: "custom-good", theme: theme() }, { id: "custom-bad", theme: {} }], "custom-good"),
    stored([{ id: "custom-good", theme: theme() }], "custom-missing"),
    memoryStorage({ [APPEARANCE_STORAGE_KEY]: "{" }),
  ];
  for (const storage of fixtures) {
    const result = serializedReader(storage, APPEARANCE_STORAGE_CONFIG, normalizeTheme);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), readAppearanceState(storage));
  }
});
