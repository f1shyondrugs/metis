import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMON_THEME_VARIABLES,
  DEFAULT_THEME_ID,
  MAX_THEME_JSON_BYTES,
  THEME_PRESETS,
  THEME_VARIABLE_DEFAULTS,
  getThemePreset,
  isValidThemeVariableName,
  normalizeTheme,
  parseThemeJson,
  resolveThemeVariables,
  serializeTheme,
  type ThemeDefinition,
} from "../lib/appearance-theme";

function custom(variables: Record<string, string> = {}, mode: "dark" | "light" = "dark"): ThemeDefinition {
  return { format: "metis-theme", version: 1, name: "My theme", mode, variables };
}

test("six complete presets use Midnight by default and omit the retired Metis preset", () => {
  assert.deepEqual(THEME_PRESETS.map((theme) => theme.id), [
    "midnight", "graphite", "nord", "forest", "sand", "paper",
  ]);
  assert.equal(DEFAULT_THEME_ID, "midnight");
  assert.equal(getThemePreset("metis"), undefined);
  assert.equal(getThemePreset(DEFAULT_THEME_ID)!.variables["--background"], "oklch(0.125 0 0)");
  assert.equal(getThemePreset(DEFAULT_THEME_ID)!.variables["--foreground"], "oklch(0.985 0 0)");
  assert.equal(getThemePreset("missing"), undefined);
  assert.equal(THEME_PRESETS.filter((theme) => theme.mode === "light").length, 2);
  for (const preset of THEME_PRESETS) {
    assert.deepEqual(normalizeTheme(preset).variables, resolveThemeVariables(preset));
    assert.ok(preset.description.length);
    for (const name of [
      "--background", "--foreground", "--card", "--popover", "--primary",
      "--muted-foreground", "--sidebar", "--sidebar-ring", "--chart-5",
      "--radius", "--font-sans", "--font-mono", "--spacing",
    ]) {
      assert.ok(preset.variables[name], preset.id + " is missing " + name);
    }
    const exported = parseThemeJson(serializeTheme(preset));
    assert.deepEqual(exported.variables, preset.variables);
    assert.equal("id" in exported, false);
    assert.equal("description" in exported, false);
  }
});

test("Midnight and Graphite preserve the previous neutral surface values", () => {
  const midnight = getThemePreset("midnight")!;
  const graphite = getThemePreset("graphite")!;
  assert.equal(midnight.variables["--background"], "oklch(0.125 0 0)");
  assert.equal(midnight.variables["--sidebar"], "oklch(0.115 0 0)");
  assert.equal(graphite.variables["--background"], "oklch(0.245 0 0)");
  assert.equal(graphite.variables["--sidebar"], "oklch(0.21 0 0)");
  assert.equal(graphite.variables["--primary"], midnight.variables["--primary"]);
  assert.equal(graphite.variables["--sidebar-foreground"], midnight.variables["--sidebar-foreground"]);
});

test("partial custom themes resolve against their own color mode", () => {
  const dark = resolveThemeVariables(custom({ "--primary": "#bad4b8" }));
  const light = resolveThemeVariables(custom({ "--primary": "#235e3a" }, "light"));
  assert.equal(dark["--background"], THEME_VARIABLE_DEFAULTS.dark["--background"]);
  assert.equal(light["--background"], THEME_VARIABLE_DEFAULTS.light["--background"]);
  assert.notEqual(dark["--foreground"], light["--foreground"]);
  assert.equal(dark["--primary"], "#bad4b8");
  assert.equal(light["--primary"], "#235e3a");
  assert.equal(dark["--color-primary"], "var(--primary)");
});

test("customization is unrestricted by token category and retains valid custom names", () => {
  const variables = {
    "--spacing": "0.3rem",
    "--font-sans": '"A; Local Font", ui-sans-serif, sans-serif',
    "--text-sm": "clamp(0.8rem, 1vw, 1rem)",
    "--radius": "0.8rem",
    "--radius-md": "0",
    "--shadow-md": "0 4px 16px rgb(0 0 0 / 20%)",
    "--color-red-500": "oklch(0.6 0.2 25)",
    "--my-product-density": "calc(var(--spacing) * 3)",
    "--Mixed-CASE": "linear-gradient(to right, #123, #456)",
    "--1": "1",
    "--日本語": "2px",
    "--escaped\\:name": "3px",
  };
  const input = custom(variables);
  const parsed = parseThemeJson(JSON.stringify(input));
  assert.deepEqual(parsed, input);
  const exported = parseThemeJson(serializeTheme(parsed));
  for (const [key, value] of Object.entries(variables)) {
    assert.equal(exported.variables[key], value);
  }
  assert.equal(exported.variables["--radius-lg"], "var(--radius)");
  assert.equal(exported.variables["--radius-xl"], "calc(var(--radius) * 1.4)");
  assert.equal(exported.variables["--color-background"], "var(--background)");
});

test("font defaults use the loaded app fonts without a self-reference", () => {
  assert.equal(COMMON_THEME_VARIABLES["--font-heading"], "var(--font-sans)");
  assert.match(COMMON_THEME_VARIABLES["--font-sans"], /^var\(--font-geist-sans,/);
  assert.match(COMMON_THEME_VARIABLES["--font-mono"], /^var\(--font-geist-mono,/);
});

test("normalization trims values and copies data without mutating input or defaults", () => {
  const input = { ...custom({ "--primary": "  #123456  " }), name: "  Local theme  " };
  const parsed = normalizeTheme(input);
  assert.equal(parsed.name, "Local theme");
  assert.equal(parsed.variables["--primary"], "#123456");
  assert.equal(input.name, "  Local theme  ");
  assert.equal(input.variables["--primary"], "  #123456  ");
  parsed.variables["--primary"] = "#ffffff";
  const resolved = resolveThemeVariables(custom());
  resolved["--primary"] = "#000000";
  assert.notEqual(THEME_VARIABLE_DEFAULTS.dark["--primary"], "#000000");
  assert.notEqual(input.variables["--primary"], parsed.variables["--primary"]);
});

test("a full export is stable and does not require the original preset", () => {
  const theme = custom({ "--z-extra": "2", "--a-extra": "1" }, "light");
  const serialized = serializeTheme(theme);
  assert.ok(serialized.endsWith("\n"));
  const parsed = parseThemeJson(serialized);
  assert.equal(parsed.variables["--background"], THEME_VARIABLE_DEFAULTS.light["--background"]);
  assert.equal(parsed.variables["--a-extra"], "1");
  assert.equal(parsed.variables["--z-extra"], "2");
  assert.equal(serializeTheme(parsed), serialized);
});

test("JSON parsing reports malformed and oversized files, including UTF-8 byte limits", () => {
  assert.throws(() => parseThemeJson("{"), /Invalid theme JSON/);
  assert.throws(() => parseThemeJson('{"name":"x",}'), /Invalid theme JSON/);
  assert.throws(() => parseThemeJson(" ".repeat(MAX_THEME_JSON_BYTES + 1)), /256 KiB/);
  assert.throws(() => parseThemeJson("é".repeat(MAX_THEME_JSON_BYTES / 2 + 1)), /256 KiB/);
  assert.deepEqual(parseThemeJson("\ufeff" + JSON.stringify(custom())), custom());
});

test("object normalization and full export enforce the same portable file budget", () => {
  const tooLarge = custom(Object.fromEntries(
    Array.from({ length: 80 }, (_, index) => ["--large-" + index, "x".repeat(4000)]),
  ));
  assert.throws(() => normalizeTheme(tooLarge), /256 KiB/);
  const nearLimit = custom(Object.fromEntries(
    Array.from({ length: 64 }, (_, index) => ["--large-" + index, "x".repeat(4000)]),
  ));
  assert.doesNotThrow(() => normalizeTheme(nearLimit));
  assert.throws(() => serializeTheme(nearLimit), /full theme exceeds 256 KiB/);
});

test("invalid file structure produces actionable errors", () => {
  for (const value of [null, [], "theme", 1]) {
    assert.throws(() => normalizeTheme(value), /JSON object/);
  }
  const invalid = [
    [{ ...custom(), format: "other" }, /Theme format/],
    [{ ...custom(), version: 2 }, /Unsupported theme version/],
    [{ ...custom(), version: "1" }, /Unsupported theme version/],
    [{ ...custom(), name: "   " }, /theme name/],
    [{ ...custom(), name: "x".repeat(121) }, /theme name/],
    [{ ...custom(), name: "A\nB" }, /control characters/],
    [{ ...custom(), mode: "system" }, /Theme mode/],
    [{ ...custom(), variables: [] }, /Theme variables/],
    [{ ...custom(), variables: null }, /Theme variables/],
    [{ ...custom(), variables: { "--primary": 42 } }, /--primary.*CSS string/],
    [{ ...custom(), variables: { "--primary": {} } }, /--primary.*CSS string/],
    [custom({ "--primary": "" }), /--primary.*characters/],
    [custom({ "--primary": "a".repeat(4097) }), /--primary.*characters/],
    [custom(Object.fromEntries(Array.from({ length: 2049 }, (_, index) => ["--v" + index, "0"]))), /2048/],
  ] as const;
  for (const [input, error] of invalid) assert.throws(() => normalizeTheme(input), error);
});

test("CSS custom-property names follow syntax rather than a color-token whitelist", () => {
  for (const name of ["--primary", "--1", "---", "--_x", "--é", "--日本語", "--foo\\:bar", "--f\\6f o"]) {
    assert.equal(isValidThemeVariableName(name), true, name);
  }
  for (const name of ["--", "primary", "-primary", "--bad name", "--x;", "--x\n", "--x\\"]) {
    assert.equal(isValidThemeVariableName(name), false, name);
    assert.throws(() => normalizeTheme(custom({ [name]: "red" })), /Invalid CSS custom-property name/);
  }
});

test("CSS rules, priorities, resource URLs, scripts, and obfuscated variants are rejected", () => {
  for (const value of [
    "red; color: blue",
    "red } body { color: red",
    "@import 'remote.css'",
    "red !important",
    'url("https://example.test/image.png")',
    'u\\72l("https://example.test/image.png")',
    '\\75\\72\\6c("https://example.test/image.png")',
    'image-set("https://example.test/image.png" 1x)',
    '-webkit-image-set("https://example.test/image.png" 1x)',
    'src("https://example.test/font.woff2")',
    'image("https://example.test/image.png")',
    "expression(alert(1))",
    "\\65xpression(alert(1))",
    "javascript:alert(1)",
    "data:image/svg+xml,test",
    "red/*comment*/",
    "u/**/rl(x)",
    "red\u0000",
    "<style>",
    "'unfinished",
    "'line\nbreak'",
    "calc(1rem + 2px",
    "calc(1rem + 2px))",
    "([)]",
    "red\\",
  ]) {
    assert.throws(
      () => parseThemeJson(JSON.stringify(custom({ "--custom": value }))),
      /--custom/,
      value,
    );
  }
});

test("ordinary colors, font lists, calculations, shadows, and CSS variable fallbacks remain valid", () => {
  for (const value of [
    "#123456",
    "oklch(0.5 0.1 200 / 80%)",
    "color-mix(in oklch, var(--primary), white 20%)",
    "calc(var(--spacing, 0.25rem) * 4)",
    "clamp(12px, 1vw, 20px)",
    '"Local Font", system-ui, sans-serif',
    "0 4px 10px rgb(0 0 0 / 20%), inset 0 1px #fff",
    "cubic-bezier(0.4, 0, 0.2, 1)",
  ]) {
    assert.equal(normalizeTheme(custom({ "--custom": value })).variables["--custom"], value);
  }
});
