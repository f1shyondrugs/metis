import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { createAppearanceBootstrapScript } from "../lib/appearance-bootstrap";
import {
  DEFAULT_THEME_ID,
  THEME_PRESETS,
  getThemePreset,
  parseThemeJson,
  resolveThemeVariables,
  serializeTheme,
  type ThemeDefinition,
} from "../lib/appearance-theme";
import {
  APPEARANCE_STORAGE_KEY,
  APPLIED_THEME_VARIABLES_ATTRIBUTE,
  LEGACY_APPEARANCE_STORAGE_KEY,
  MAX_APPEARANCE_STATE_BYTES,
  applyAppearanceTheme,
  createCustomTheme,
  createDefaultAppearanceState,
  getSelectedTheme,
  persistAppearanceState,
  readAppearanceState,
} from "../lib/appearance-storage";

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function rootElement() {
  const values = new Map<string, string>([["font-size", "16px"], ["--font-geist-sans", "loaded-font"]]);
  const attributes = new Map<string, string>();
  const classes = new Set(["dark", "font-loaded"]);
  return {
    style: {
      setProperty: (name: string, value: string) => { values.set(name, value); },
      removeProperty: (name: string) => { const old = values.get(name) ?? ""; values.delete(name); return old; },
      getPropertyValue: (name: string) => values.get(name) ?? "",
      colorScheme: "",
    },
    classList: {
      toggle: (name: string, enabled: boolean) => { if (enabled) classes.add(name); else classes.delete(name); },
      contains: (name: string) => classes.has(name),
    },
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    values,
  };
}

function boot(saved: Pick<Storage, "getItem">, script = createAppearanceBootstrapScript()) {
  const root = rootElement();
  runInNewContext(script, {
    window: { localStorage: saved },
    document: { documentElement: root },
    TextEncoder,
  }, {
    timeout: 1000,
    contextCodeGeneration: { strings: false, wasm: false },
  });
  return root;
}

function assertTheme(root: ReturnType<typeof rootElement>, theme: ThemeDefinition, id: string) {
  const variables = resolveThemeVariables(theme);
  assert.equal(root.getAttribute("data-surface"), id);
  assert.equal(root.classList.contains("dark"), theme.mode === "dark");
  assert.equal(root.classList.contains("font-loaded"), true);
  assert.equal(root.style.colorScheme, theme.mode);
  assert.deepEqual(JSON.parse(root.getAttribute(APPLIED_THEME_VARIABLES_ATTRIBUTE)!), Object.keys(variables));
  for (const [name, value] of Object.entries(variables)) assert.equal(root.style.getPropertyValue(name), value, name);
  assert.equal(root.style.getPropertyValue("font-size"), "16px");
  assert.equal(root.style.getPropertyValue("--font-geist-sans"), "loaded-font");
}

function custom(variables: Record<string, string> = {}, mode: "dark" | "light" = "light"): ThemeDefinition {
  return { format: "metis-theme", version: 1, name: "Custom", mode, variables };
}

function stored(selected: string, customThemes: unknown[] = []) {
  return JSON.stringify({ version: 1, selected, customThemes });
}

test("pre-paint script restores every preset, including dark and light roots", () => {
  for (const preset of THEME_PRESETS) {
    const saved = storage({ [APPEARANCE_STORAGE_KEY]: stored(preset.id) });
    assertTheme(boot(saved), preset, preset.id);
  }
  assertTheme(boot(storage()), getThemePreset(DEFAULT_THEME_ID)!, DEFAULT_THEME_ID);
  assertTheme(
    boot(storage({ [LEGACY_APPEARANCE_STORAGE_KEY]: "graphite" })),
    getThemePreset("graphite")!, "graphite",
  );
});

test("removed Metis selection resolves to Midnight before paint for browser and account state", () => {
  const state = {version:1,selected:"metis",customThemes:[{id:"custom-kept",theme:custom({"--background":"#123456"})}]};
  const saved = storage({[APPEARANCE_STORAGE_KEY]:JSON.stringify(state)});
  assertTheme(boot(saved),getThemePreset("midnight")!,"midnight");
  assertTheme(boot(storage(),createAppearanceBootstrapScript({state,allowLocalStorage:false})),getThemePreset("midnight")!,"midnight");
  assert.equal(JSON.parse(saved.getItem(APPEARANCE_STORAGE_KEY)!).selected,"metis");
});

test("import, export, persistence and bootstrap retain full custom variables", () => {
  const imported = parseThemeJson(serializeTheme({
    ...custom({
      "--background": "#f9f5ee",
      "--spacing": "0.3rem",
      "--font-sans": '"Local; Font", ui-sans-serif',
      "--product-density": "calc(var(--spacing) * 3)",
      "--日本語": "2px",
      "--escaped\\:name": "3px",
    }),
    // This text stays in storage and must never be interpolated into script HTML.
    name: "</script><script>globalThis.injected = true</script>",
  }));
  const state = createCustomTheme(createDefaultAppearanceState(), imported, "custom-roundtrip");
  const saved = storage();
  persistAppearanceState(saved, state);
  const root = boot(saved);
  assertTheme(root, imported, state.selected);

  // The provider must recognize and clear the variables installed before hydration.
  applyAppearanceTheme(root as unknown as HTMLElement, getThemePreset("midnight")!, "midnight");
  assert.equal(root.style.getPropertyValue("--product-density"), "");
  assert.equal(root.style.getPropertyValue("--日本語"), "");
  assertTheme(root, getThemePreset("midnight")!, "midnight");
});

test("account state takes precedence over another account's browser themes", () => {
  const otherAccount = createCustomTheme(
    createDefaultAppearanceState(), custom({ "--other-account": "8px" }, "dark"), "custom-other-account",
  );
  const saved = storage();
  persistAppearanceState(saved, otherAccount);
  for (const mode of ["dark", "light"] as const) {
    const state = createCustomTheme(
      createDefaultAppearanceState(), custom({ "--account-density": "3px" }, mode), "custom-account-" + mode,
    );
    const script = createAppearanceBootstrapScript({ state, allowLocalStorage: false });
    assertTheme(boot(saved, script), getSelectedTheme(state), state.selected);
    assert.equal(boot(saved, script).style.getPropertyValue("--other-account"), "");

    let reads = 0;
    const root = rootElement();
    runInNewContext(script, {
      window: Object.defineProperty({}, "localStorage", { get() { reads += 1; throw new Error("must not read"); } }),
      document: { documentElement: root },
      TextEncoder,
    });
    assert.equal(reads, 0);
    assertTheme(root, getSelectedTheme(state), state.selected);
    // A supplied state also wins when callers leave the legacy fallback enabled.
    assertTheme(boot(saved, createAppearanceBootstrapScript({ state })), getSelectedTheme(state), state.selected);
  }
});

test("disabled local storage never restores global state when account data is missing or invalid", () => {
  const invalidStates: unknown[] = [
    undefined,
    null,
    [],
    { version: 2, selected: "paper", customThemes: [] },
    { version: 1, selected: "missing-account-theme", customThemes: [] },
    {
      version: 1, selected: "custom-unsafe",
      customThemes: [{ id: "custom-unsafe", theme: custom({ "--unsafe": "url(https://example.invalid)" }) }],
    },
  ];
  const saved = storage({
    [APPEARANCE_STORAGE_KEY]: stored("paper"),
    [LEGACY_APPEARANCE_STORAGE_KEY]: "graphite",
  });
  const scripts = [
    createAppearanceBootstrapScript({ allowLocalStorage: false }),
    ...invalidStates.map((state) => createAppearanceBootstrapScript({ state, allowLocalStorage: false })),
  ];
  for (const script of scripts) {
    assertTheme(boot(saved, script), getThemePreset(DEFAULT_THEME_ID)!, DEFAULT_THEME_ID);
    let reads = 0;
    const root = rootElement();
    runInNewContext(script, {
      window: Object.defineProperty({}, "localStorage", { get() { reads += 1; return saved; } }),
      document: { documentElement: root },
      TextEncoder,
    });
    assert.equal(reads, 0);
    assertTheme(root, getThemePreset(DEFAULT_THEME_ID)!, DEFAULT_THEME_ID);
  }
});

test("server-provided custom themes stay safe inside script HTML", () => {
  const theme = {
    ...custom({
      "--quoted-content": '"</script><script>globalThis.injected=true</script>"',
      "--unicode-content": '"line\u2028separator\u2029"',
    }),
    name: "</script><script>globalThis.injected=true</script>",
  };
  const state = createCustomTheme(createDefaultAppearanceState(), theme, "custom-html-safe");
  const script = createAppearanceBootstrapScript({ state, allowLocalStorage: false });
  assert.doesNotMatch(script, /<\/script/i);
  assert.doesNotMatch(script, /[\u2028\u2029]/);
  assertTheme(boot(storage(), script), theme, state.selected);
});

test("bootstrap and the hydrated reader make the same recovery decisions", () => {
  const valid = { id: "custom-valid", theme: custom({ "--extra": "4px" }) };
  const cases = [
    "{broken",
    "[]",
    "null",
    JSON.stringify({ version: 2, selected: "paper", customThemes: [] }),
    '{"version":1,"selected":"paper","customThemes":[],"__proto__":{}}',
    stored("unknown"),
    stored("toString"),
    stored("custom-valid", [{ id: "custom-invalid", theme: { mode: "light" } }, valid]),
    stored("custom-valid", [{ ...valid, constructor: {} }, valid]),
    stored("custom-valid", [{ ...valid, theme: { ...valid.theme, prototype: {} } }, valid]),
    stored("custom-valid", [valid, { ...valid, theme: custom({ "--extra": "8px" }, "dark") }]),
    stored("custom-valid", [{ id: "../custom-valid", theme: valid.theme }]),
    stored("custom-after-limit", [
      ...Array.from({ length: 20 }, (_, index) => ({ id: "custom-" + index, theme: custom() })),
      { id: "custom-after-limit", theme: custom() },
    ]),
    " ".repeat(MAX_APPEARANCE_STATE_BYTES + 1),
  ];
  for (const json of cases) {
    const saved = storage({
      [APPEARANCE_STORAGE_KEY]: json,
      [LEGACY_APPEARANCE_STORAGE_KEY]: "graphite",
    });
    const expected = readAppearanceState(saved);
    assertTheme(boot(saved), getSelectedTheme(expected), expected.selected);
  }
});

test("blocked storage safely applies the default before hydration", () => {
  const denied = { getItem() { throw new Error("SecurityError"); } };
  assertTheme(boot(denied), getThemePreset(DEFAULT_THEME_ID)!, DEFAULT_THEME_ID);

  const root = rootElement();
  runInNewContext(createAppearanceBootstrapScript(), {
    window: Object.defineProperty({}, "localStorage", { get() { throw new Error("SecurityError"); } }),
    document: { documentElement: root },
    TextEncoder,
  });
  assertTheme(root, getThemePreset(DEFAULT_THEME_ID)!, DEFAULT_THEME_ID);
});

test("unsafe or malformed persisted CSS never reaches the document", () => {
  const badValues: unknown[] = [
    "url(https://example.invalid/pixel)",
    "u\\72l(https://example.invalid/pixel)",
    "image-set('https://example.invalid/pixel' 1x)",
    "image('https://example.invalid/pixel')",
    "expression(alert(1))",
    "/* hidden */ red",
    "red; color: blue",
    "var(--unterminated",
    "red!important",
    "red\u0000",
    42,
  ];
  for (const value of badValues) {
    const theme = { ...custom(), variables: { "--unsafe": value } };
    const saved = storage({
      [APPEARANCE_STORAGE_KEY]: stored("custom-unsafe", [{ id: "custom-unsafe", theme }]),
    });
    const root = boot(saved);
    assertTheme(root, getThemePreset(DEFAULT_THEME_ID)!, DEFAULT_THEME_ID);
    assert.equal(root.style.getPropertyValue("--unsafe"), "");
  }
});

test("inline payload remains safe HTML and needs no dynamic code evaluation", () => {
  const script = createAppearanceBootstrapScript();
  assert.doesNotMatch(script, /<\/script/i);
  assert.doesNotMatch(script, /[\u2028\u2029]/);
  assert.doesNotMatch(script, /\beval\s*\(|new\s+Function\b/);
  // boot() disables dynamic string compilation in its VM context.
  assertTheme(boot(storage(), script), getThemePreset(DEFAULT_THEME_ID)!, DEFAULT_THEME_ID);
});

test("bundled and minified generators keep their shared parsers closure-free", () => {
  const require = createRequire(import.meta.url);
  // esbuild belongs to the pinned tsx toolchain; no new runtime dependency is needed.
  const { buildSync } = createRequire(require.resolve("tsx"))("esbuild") as {
    buildSync(options: Record<string, unknown>): { outputFiles: { text: string }[] };
  };
  const saved = storage({
    [APPEARANCE_STORAGE_KEY]: stored("custom-bundled", [{
      id: "custom-bundled", theme: custom({ "--extra": "7px", "--primary": "#456789" }),
    }]),
  });
  for (const minify of [false, true]) {
    const built = buildSync({
      entryPoints: [fileURLToPath(new URL("../lib/appearance-bootstrap.ts", import.meta.url))],
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "es2022",
      write: false,
      minify,
      keepNames: true,
    });
    const bundledModule = { exports: {} as { createAppearanceBootstrapScript: typeof createAppearanceBootstrapScript } };
    runInNewContext(built.outputFiles[0].text, { module: bundledModule, exports: bundledModule.exports });
    const script = bundledModule.exports.createAppearanceBootstrapScript();
    assert.doesNotMatch(script, /__name/);
    assertTheme(boot(saved, script), getSelectedTheme(readAppearanceState(saved)), "custom-bundled");
    const accountState = { ...createDefaultAppearanceState(), selected: "paper" };
    // Parse the fixture in the bundle realm, as server JSON is parsed in its own runtime.
    const accountScript = runInNewContext(built.outputFiles[0].text +
      "\nmodule.exports.createAppearanceBootstrapScript({ state: JSON.parse(accountStateJson), allowLocalStorage: false });", {
      module: bundledModule, exports: bundledModule.exports, TextEncoder,
      accountStateJson: JSON.stringify(accountState),
    }) as string;
    assertTheme(boot(saved, accountScript), getThemePreset("paper")!, "paper");
  }
});
