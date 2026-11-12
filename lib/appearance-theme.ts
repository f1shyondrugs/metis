/**
 * Portable appearance themes. This module is shared by the browser and tests:
 * it deliberately has no DOM, storage, or server dependencies.
 */
export const THEME_FORMAT = "metis-theme" as const;
export const THEME_VERSION = 1 as const;
export const DEFAULT_THEME_ID = "metis";
export const MAX_THEME_JSON_BYTES = 256 * 1024;

export type ThemeMode = "dark" | "light";

export interface ThemeDefinition {
  format: typeof THEME_FORMAT;
  version: typeof THEME_VERSION;
  name: string;
  mode: ThemeMode;
  variables: Record<string, string>;
}

export interface ThemePreset extends ThemeDefinition {
  id: string;
  description: string;
}

/**
 * Validate imported/persisted data and return an independent, normalized copy.
 *
 * Keep this function closure-free, including its validation constants. The
 * pre-hydration bootstrap serializes this exact function; its tests also execute
 * the bundled function so stored data follows the same contract before React.
 */
export function normalizeTheme(input: unknown): ThemeDefinition {
  if (
    !input || typeof input !== "object" || Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)
  ) {
    throw new Error("A theme must be a JSON object.");
  }
  const candidate = input as Record<string, unknown>;
  if (candidate.format !== "metis-theme") {
    throw new Error('Theme format must be "metis-theme".');
  }
  if (candidate.version !== 1) {
    throw new Error("Unsupported theme version. This app supports version 1.");
  }
  if (typeof candidate.name !== "string" || !candidate.name.trim() || candidate.name.trim().length > 120) {
    throw new Error("A theme name must contain 1–120 characters.");
  }
  if (/[\u0000-\u001f\u007f]/.test(candidate.name)) {
    throw new Error("A theme name cannot contain control characters.");
  }
  if (candidate.mode !== "dark" && candidate.mode !== "light") {
    throw new Error('Theme mode must be "dark" or "light".');
  }
  if (
    !candidate.variables || typeof candidate.variables !== "object" || Array.isArray(candidate.variables) ||
    (Object.getPrototypeOf(candidate.variables) !== Object.prototype && Object.getPrototypeOf(candidate.variables) !== null)
  ) {
    throw new Error("Theme variables must be an object of CSS custom-property names and string values.");
  }
  const entries = Object.entries(candidate.variables);
  if (entries.length > 2048) {
    throw new Error("A theme can contain at most 2048 CSS variables.");
  }
  const variables: Record<string, string> = {};
  for (const [name, value] of entries) {
    // CSS <dashed-ident>, including Unicode and escaped identifiers.
    if (!/^--(?:[a-zA-Z0-9_-]|[^\u0000-\u007f]|\\(?:[0-9a-fA-F]{1,6}[\t\n\f\r ]?|[^\n\r\f0-9a-fA-F]))+$/u.test(name)) {
      throw new Error('Invalid CSS custom-property name "' + name + '". Names must start with "--".');
    }
    if (typeof value !== "string") {
      throw new Error('The value for "' + name + '" must be a CSS string.');
    }
    const normalized = value.trim();
    if (!normalized || normalized.length > 4096) {
      throw new Error('The value for "' + name + '" must contain 1–4096 characters.');
    }

    // Accept one CSS component-value sequence. Custom properties can hold font
    // lists, colors, numbers, shadows, calc(), var(), etc.; the browser determines
    // whether the CSS property consuming a variable accepts its value.
    const brackets: string[] = [];
    let quote: "'" | '"' | null = null;
    let decoded = "";
    for (let index = 0; index < normalized.length; index += 1) {
      const character = normalized[index];
      if (character === "\\") {
        const escape = normalized.slice(index).match(/^\\([0-9a-fA-F]{1,6}[\t\n\f\r ]?|[^\n\r\f0-9a-fA-F])/);
        if (!escape) throw new Error('The value for "' + name + '" has an invalid CSS escape.');
        const escaped = escape[1];
        if (/^[0-9a-fA-F]/.test(escaped)) {
          const point = Number.parseInt(escaped.trim(), 16);
          decoded += point === 0 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)
            ? "\ufffd"
            : String.fromCodePoint(point);
        } else {
          decoded += escaped;
        }
        index += escape[0].length - 1;
        continue;
      }
      decoded += character;
      if (quote) {
        if (character === quote) quote = null;
        else if (character === "\n" || character === "\r" || character === "\f") {
          throw new Error('The value for "' + name + '" has an unterminated CSS string.');
        }
        continue;
      }
      if (character === "'" || character === '"') {
        quote = character;
      } else if (";{}@!<>".includes(character)) {
        throw new Error('The value for "' + name + '" must be one CSS value, without rules or !important.');
      } else if (character === "(" || character === "[") {
        brackets.push(character);
      } else if (character === ")" || character === "]") {
        if (brackets.pop() !== (character === ")" ? "(" : "[")) {
          throw new Error('The value for "' + name + '" has unmatched CSS brackets.');
        }
      }
    }
    if (quote || brackets.length) {
      throw new Error('The value for "' + name + '" has an unterminated CSS string or function.');
    }

    // Escape spelling cannot hide a resource function or script protocol.
    // Reject comments too, including obfuscated tokens crossing their boundaries.
    if (
      /\/\*|\*\//.test(decoded) ||
      /\b(?:url|src|image|image-set|-webkit-image-set|expression)\s*\(/i.test(decoded) ||
      /(?:javascript|vbscript|data)\s*:/i.test(decoded) ||
      /[\u0000-\u0008\u000b\u000e-\u001f\u007f]/.test(decoded)
    ) {
      throw new Error('The value for "' + name + '" contains a URL, script, comment, or control character.');
    }
    variables[name] = normalized;
  }
  const theme: ThemeDefinition = {
    format: "metis-theme",
    version: 1,
    name: candidate.name.trim(),
    mode: candidate.mode,
    variables,
  };
  if (new TextEncoder().encode(JSON.stringify(theme)).byteLength > 256 * 1024) {
    throw new Error("Theme JSON must be no larger than 256 KiB.");
  }
  return theme;
}

/** Validate syntax, rather than restricting themes to a list of known tokens. */
export function isValidThemeVariableName(name: string): boolean {
  try {
    normalizeTheme({
      format: "metis-theme",
      version: 1,
      name: "Variable validation",
      mode: "dark",
      variables: { [name]: "0" },
    });
    return true;
  } catch {
    return false;
  }
}

export function parseThemeJson(json: string): ThemeDefinition {
  if (new TextEncoder().encode(json).byteLength > MAX_THEME_JSON_BYTES) {
    throw new Error("Theme JSON must be no larger than 256 KiB.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.replace(/^\ufeff/, ""));
  } catch {
    throw new Error("Invalid theme JSON. Check quotes, commas, and brackets.");
  }
  return normalizeTheme(parsed);
}

// These are the existing app's semantic tokens and Tailwind's runtime design
// tokens. Aliases stay expressions so editing a base token updates its consumers.
export const COMMON_THEME_VARIABLES: Readonly<Record<string, string>> = Object.freeze({
  "--radius": "0.625rem",
  "--radius-xs": "0.125rem",
  "--radius-sm": "calc(var(--radius) * 0.6)",
  "--radius-md": "calc(var(--radius) * 0.8)",
  "--radius-lg": "var(--radius)",
  "--radius-xl": "calc(var(--radius) * 1.4)",
  "--radius-2xl": "calc(var(--radius) * 1.8)",
  "--radius-3xl": "calc(var(--radius) * 2.2)",
  "--radius-4xl": "calc(var(--radius) * 2.6)",
  "--spacing": "0.25rem",
  "--font-sans": "var(--font-geist-sans, ui-sans-serif, system-ui, sans-serif)",
  "--font-heading": "var(--font-sans)",
  "--font-mono": "var(--font-geist-mono, ui-monospace, SFMono-Regular, monospace)",
  "--text-xs": "0.75rem",
  "--text-xs--line-height": "calc(1 / 0.75)",
  "--text-sm": "0.875rem",
  "--text-sm--line-height": "calc(1.25 / 0.875)",
  "--text-base": "1rem",
  "--text-base--line-height": "calc(1.5 / 1)",
  "--text-lg": "1.125rem",
  "--text-lg--line-height": "calc(1.75 / 1.125)",
  "--text-xl": "1.25rem",
  "--text-xl--line-height": "calc(1.75 / 1.25)",
  "--text-2xl": "1.5rem",
  "--text-2xl--line-height": "calc(2 / 1.5)",
  "--text-3xl": "1.875rem",
  "--text-3xl--line-height": "calc(2.25 / 1.875)",
  "--text-4xl": "2.25rem",
  "--text-4xl--line-height": "calc(2.5 / 2.25)",
  "--text-5xl": "3rem",
  "--text-5xl--line-height": "1",
  "--text-6xl": "3.75rem",
  "--text-6xl--line-height": "1",
  "--text-7xl": "4.5rem",
  "--text-7xl--line-height": "1",
  "--text-8xl": "6rem",
  "--text-8xl--line-height": "1",
  "--text-9xl": "8rem",
  "--text-9xl--line-height": "1",
  "--font-weight-thin": "100",
  "--font-weight-extralight": "200",
  "--font-weight-light": "300",
  "--font-weight-normal": "400",
  "--font-weight-medium": "500",
  "--font-weight-semibold": "600",
  "--font-weight-bold": "700",
  "--font-weight-extrabold": "800",
  "--font-weight-black": "900",
  "--tracking-tighter": "-0.05em",
  "--tracking-tight": "-0.025em",
  "--tracking-normal": "0em",
  "--tracking-wide": "0.025em",
  "--tracking-wider": "0.05em",
  "--tracking-widest": "0.1em",
  "--leading-tight": "1.25",
  "--leading-snug": "1.375",
  "--leading-normal": "1.5",
  "--leading-relaxed": "1.625",
  "--leading-loose": "2",
  "--shadow-2xs": "0 1px rgb(0 0 0 / 0.05)",
  "--shadow-xs": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
  "--shadow-sm": "0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)",
  "--shadow-md": "0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)",
  "--shadow-lg": "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
  "--shadow-xl": "0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)",
  "--shadow-2xl": "0 25px 50px -12px rgb(0 0 0 / 0.25)",
  "--ease-in": "cubic-bezier(0.4, 0, 1, 1)",
  "--ease-out": "cubic-bezier(0, 0, 0.2, 1)",
  "--ease-in-out": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--default-transition-duration": "150ms",
  "--default-transition-timing-function": "cubic-bezier(0.4, 0, 0.2, 1)",
  "--color-background": "var(--background)",
  "--color-foreground": "var(--foreground)",
  "--color-card": "var(--card)",
  "--color-card-foreground": "var(--card-foreground)",
  "--color-popover": "var(--popover)",
  "--color-popover-foreground": "var(--popover-foreground)",
  "--color-primary": "var(--primary)",
  "--color-primary-foreground": "var(--primary-foreground)",
  "--color-secondary": "var(--secondary)",
  "--color-secondary-foreground": "var(--secondary-foreground)",
  "--color-muted": "var(--muted)",
  "--color-muted-foreground": "var(--muted-foreground)",
  "--color-accent": "var(--accent)",
  "--color-accent-foreground": "var(--accent-foreground)",
  "--color-destructive": "var(--destructive)",
  "--color-border": "var(--border)",
  "--color-input": "var(--input)",
  "--color-ring": "var(--ring)",
  "--color-chart-1": "var(--chart-1)",
  "--color-chart-2": "var(--chart-2)",
  "--color-chart-3": "var(--chart-3)",
  "--color-chart-4": "var(--chart-4)",
  "--color-chart-5": "var(--chart-5)",
  "--color-sidebar": "var(--sidebar)",
  "--color-sidebar-foreground": "var(--sidebar-foreground)",
  "--color-sidebar-primary": "var(--sidebar-primary)",
  "--color-sidebar-primary-foreground": "var(--sidebar-primary-foreground)",
  "--color-sidebar-accent": "var(--sidebar-accent)",
  "--color-sidebar-accent-foreground": "var(--sidebar-accent-foreground)",
  "--color-sidebar-border": "var(--sidebar-border)",
  "--color-sidebar-ring": "var(--sidebar-ring)",
});

const LIGHT_COLORS: Readonly<Record<string, string>> = {
  "--background": "oklch(0.985 0 0)",
  "--foreground": "oklch(0.145 0 0)",
  "--card": "oklch(1 0 0)",
  "--card-foreground": "oklch(0.145 0 0)",
  "--popover": "oklch(1 0 0)",
  "--popover-foreground": "oklch(0.145 0 0)",
  "--primary": "oklch(0.205 0 0)",
  "--primary-foreground": "oklch(0.985 0 0)",
  "--secondary": "oklch(0.97 0 0)",
  "--secondary-foreground": "oklch(0.205 0 0)",
  "--muted": "oklch(0.97 0 0)",
  "--muted-foreground": "oklch(0.556 0 0)",
  "--accent": "oklch(0.97 0 0)",
  "--accent-foreground": "oklch(0.205 0 0)",
  "--destructive": "oklch(0.577 0.245 27.325)",
  "--border": "oklch(0.922 0 0)",
  "--input": "oklch(0.922 0 0)",
  "--ring": "oklch(0.708 0 0)",
  "--chart-1": "oklch(0.87 0 0)",
  "--chart-2": "oklch(0.556 0 0)",
  "--chart-3": "oklch(0.439 0 0)",
  "--chart-4": "oklch(0.371 0 0)",
  "--chart-5": "oklch(0.269 0 0)",
  "--sidebar": "oklch(0.985 0 0)",
  "--sidebar-foreground": "oklch(0.145 0 0)",
  "--sidebar-primary": "oklch(0.205 0 0)",
  "--sidebar-primary-foreground": "oklch(0.985 0 0)",
  "--sidebar-accent": "oklch(0.97 0 0)",
  "--sidebar-accent-foreground": "oklch(0.205 0 0)",
  "--sidebar-border": "oklch(0.922 0 0)",
  "--sidebar-ring": "oklch(0.708 0 0)",
};

const DARK_COLORS: Readonly<Record<string, string>> = {
  "--background": "oklch(0.125 0 0)",
  "--foreground": "oklch(0.985 0 0)",
  "--card": "oklch(0.155 0 0)",
  "--card-foreground": "oklch(0.985 0 0)",
  "--popover": "oklch(0.165 0 0)",
  "--popover-foreground": "oklch(0.985 0 0)",
  "--primary": "oklch(0.922 0 0)",
  "--primary-foreground": "oklch(0.205 0 0)",
  "--secondary": "oklch(0.19 0 0)",
  "--secondary-foreground": "oklch(0.985 0 0)",
  "--muted": "oklch(0.19 0 0)",
  "--muted-foreground": "oklch(0.68 0 0)",
  "--accent": "oklch(0.205 0 0)",
  "--accent-foreground": "oklch(0.985 0 0)",
  "--destructive": "oklch(0.65 0.2 22)",
  "--border": "oklch(1 0 0 / 10%)",
  "--input": "oklch(1 0 0 / 12%)",
  "--ring": "oklch(0.5 0 0)",
  "--chart-1": "oklch(0.87 0 0)",
  "--chart-2": "oklch(0.556 0 0)",
  "--chart-3": "oklch(0.439 0 0)",
  "--chart-4": "oklch(0.371 0 0)",
  "--chart-5": "oklch(0.269 0 0)",
  "--sidebar": "oklch(0.115 0 0)",
  "--sidebar-foreground": "oklch(0.92 0 0)",
  "--sidebar-primary": "oklch(0.92 0 0)",
  "--sidebar-primary-foreground": "oklch(0.145 0 0)",
  "--sidebar-accent": "oklch(0.22 0 0)",
  "--sidebar-accent-foreground": "oklch(0.985 0 0)",
  "--sidebar-border": "oklch(1 0 0 / 8%)",
  "--sidebar-ring": "oklch(0.5 0 0)",
};

export const THEME_VARIABLE_DEFAULTS: Readonly<Record<ThemeMode, Readonly<Record<string, string>>>> = Object.freeze({
  dark: Object.freeze({ ...COMMON_THEME_VARIABLES, ...DARK_COLORS }),
  light: Object.freeze({ ...COMMON_THEME_VARIABLES, ...LIGHT_COLORS }),
});

function preset(
  id: string,
  name: string,
  description: string,
  mode: ThemeMode,
  overrides: Record<string, string> = {},
): ThemePreset {
  return Object.freeze({
    id,
    description,
    format: THEME_FORMAT,
    version: THEME_VERSION,
    name,
    mode,
    variables: Object.freeze({ ...THEME_VARIABLE_DEFAULTS[mode], ...overrides }),
  });
}

/** Complete portable definitions; IDs preserve the existing Midnight/Graphite settings. */
export const THEME_PRESETS: readonly ThemePreset[] = Object.freeze([
  preset("metis", "Metis", "Pure black and white · default", "dark", {
    "--background": "#000000", "--foreground": "#ffffff",
    "--card": "#000000", "--card-foreground": "#ffffff",
    "--popover": "#000000", "--popover-foreground": "#ffffff",
    "--primary": "#ffffff", "--primary-foreground": "#000000",
    "--secondary": "#000000", "--secondary-foreground": "#ffffff",
    "--muted": "#000000", "--muted-foreground": "#bfbfbf",
    "--accent": "#000000", "--accent-foreground": "#ffffff",
    "--border": "#404040", "--input": "#595959", "--ring": "#ffffff",
    "--sidebar": "#000000", "--sidebar-foreground": "#ffffff",
    "--sidebar-primary": "#ffffff", "--sidebar-primary-foreground": "#000000",
    "--sidebar-accent": "#000000", "--sidebar-accent-foreground": "#ffffff",
    "--sidebar-border": "#404040", "--sidebar-ring": "#ffffff",
  }),
  preset("midnight", "Midnight", "Deep neutral surfaces", "dark"),
  preset("graphite", "Graphite", "Softer charcoal surfaces", "dark", {
    "--background": "oklch(0.245 0 0)",
    "--foreground": "oklch(0.96 0 0)",
    "--card": "oklch(0.275 0 0)",
    "--card-foreground": "oklch(0.96 0 0)",
    "--popover": "oklch(0.285 0 0)",
    "--popover-foreground": "oklch(0.96 0 0)",
    "--secondary": "oklch(0.315 0 0)",
    "--muted": "oklch(0.3 0 0)",
    "--muted-foreground": "oklch(0.76 0 0)",
    "--accent": "oklch(0.35 0 0)",
    "--border": "oklch(1 0 0 / 14%)",
    "--input": "oklch(1 0 0 / 16%)",
    "--ring": "oklch(0.65 0 0)",
    "--sidebar": "oklch(0.21 0 0)",
    "--sidebar-accent": "oklch(0.32 0 0)",
    "--sidebar-border": "oklch(1 0 0 / 12%)",
    "--sidebar-ring": "oklch(0.65 0 0)",
  }),
  preset("nord", "Nord", "Cool slate with an arctic blue accent", "dark", {
    "--background": "#242933",
    "--foreground": "#eceff4",
    "--card": "#2e3440",
    "--card-foreground": "#eceff4",
    "--popover": "#343b49",
    "--popover-foreground": "#eceff4",
    "--primary": "#88c0d0",
    "--primary-foreground": "#202832",
    "--secondary": "#3b4252",
    "--secondary-foreground": "#eceff4",
    "--muted": "#323947",
    "--muted-foreground": "#b2bfd0",
    "--accent": "#434c5e",
    "--accent-foreground": "#eceff4",
    "--destructive": "#e18b96",
    "--border": "#434c5e",
    "--input": "#4c566a",
    "--ring": "#88c0d0",
    "--chart-1": "#88c0d0",
    "--chart-2": "#81a1c1",
    "--chart-3": "#a3be8c",
    "--chart-4": "#ebcb8b",
    "--chart-5": "#b48ead",
    "--sidebar": "#20252e",
    "--sidebar-foreground": "#d8dee9",
    "--sidebar-primary": "#88c0d0",
    "--sidebar-primary-foreground": "#202832",
    "--sidebar-accent": "#3b4252",
    "--sidebar-accent-foreground": "#eceff4",
    "--sidebar-border": "#3b4252",
    "--sidebar-ring": "#88c0d0",
  }),
  preset("forest", "Forest", "Deep green with a soft sage accent", "dark", {
    "--background": "#17211d",
    "--foreground": "#edf3ee",
    "--card": "#1d2a23",
    "--card-foreground": "#edf3ee",
    "--popover": "#25342b",
    "--popover-foreground": "#edf3ee",
    "--primary": "#b5d4b7",
    "--primary-foreground": "#17261b",
    "--secondary": "#2b3c31",
    "--secondary-foreground": "#edf3ee",
    "--muted": "#25352b",
    "--muted-foreground": "#afc2b3",
    "--accent": "#354b3c",
    "--accent-foreground": "#edf3ee",
    "--destructive": "#efa39a",
    "--border": "#3b5143",
    "--input": "#48614f",
    "--ring": "#a3c9a8",
    "--chart-1": "#b5d4b7",
    "--chart-2": "#83b7a2",
    "--chart-3": "#c9c28d",
    "--chart-4": "#cea783",
    "--chart-5": "#a6b8cc",
    "--sidebar": "#131d18",
    "--sidebar-foreground": "#d8e5da",
    "--sidebar-primary": "#b5d4b7",
    "--sidebar-primary-foreground": "#17261b",
    "--sidebar-accent": "#2c4033",
    "--sidebar-accent-foreground": "#edf3ee",
    "--sidebar-border": "#324637",
    "--sidebar-ring": "#a3c9a8",
  }),
  preset("sand", "Sand", "Warm ivory with an earthy accent", "light", {
    "--background": "#f5f1e8",
    "--foreground": "#302b24",
    "--card": "#fffdf8",
    "--card-foreground": "#302b24",
    "--popover": "#fffdf8",
    "--popover-foreground": "#302b24",
    "--primary": "#685139",
    "--primary-foreground": "#fffdf8",
    "--secondary": "#eae3d6",
    "--secondary-foreground": "#42382d",
    "--muted": "#ebe5d9",
    "--muted-foreground": "#6f6457",
    "--accent": "#e3d8c6",
    "--accent-foreground": "#302b24",
    "--destructive": "#ae3f35",
    "--border": "#d6ccbc",
    "--input": "#cbbda8",
    "--ring": "#8a6f4e",
    "--chart-1": "#7c6245",
    "--chart-2": "#617b67",
    "--chart-3": "#607e96",
    "--chart-4": "#ad6c45",
    "--chart-5": "#8a6e8e",
    "--sidebar": "#ece5d8",
    "--sidebar-foreground": "#42382d",
    "--sidebar-primary": "#685139",
    "--sidebar-primary-foreground": "#fffdf8",
    "--sidebar-accent": "#ddd1bd",
    "--sidebar-accent-foreground": "#302b24",
    "--sidebar-border": "#d3c7b5",
    "--sidebar-ring": "#8a6f4e",
  }),
  preset("paper", "Paper", "Clean white with an ink blue accent", "light", {
    "--background": "#f8fafc",
    "--foreground": "#182536",
    "--card": "#ffffff",
    "--card-foreground": "#182536",
    "--popover": "#ffffff",
    "--popover-foreground": "#182536",
    "--primary": "#315d85",
    "--primary-foreground": "#ffffff",
    "--secondary": "#edf1f5",
    "--secondary-foreground": "#283d54",
    "--muted": "#eef2f6",
    "--muted-foreground": "#586a7e",
    "--accent": "#e2eaf2",
    "--accent-foreground": "#182536",
    "--destructive": "#b53d43",
    "--border": "#d7dfe8",
    "--input": "#c2cddb",
    "--ring": "#4879a5",
    "--chart-1": "#315d85",
    "--chart-2": "#3e806d",
    "--chart-3": "#9b7040",
    "--chart-4": "#8c638f",
    "--chart-5": "#ba5f50",
    "--sidebar": "#edf1f6",
    "--sidebar-foreground": "#283d54",
    "--sidebar-primary": "#315d85",
    "--sidebar-primary-foreground": "#ffffff",
    "--sidebar-accent": "#dce5ef",
    "--sidebar-accent-foreground": "#182536",
    "--sidebar-border": "#d0dae6",
    "--sidebar-ring": "#4879a5",
  }),
]);

export function getThemePreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((theme) => theme.id === id);
}

/** Fill omitted variables from the mode's base while retaining all extra tokens. */
export function resolveThemeVariables(theme: ThemeDefinition): Record<string, string> {
  const normalized = normalizeTheme(theme);
  return { ...THEME_VARIABLE_DEFAULTS[normalized.mode], ...normalized.variables };
}

/** Export full defaults + overrides so a file never depends on a preset ID. */
export function serializeTheme(theme: ThemeDefinition): string {
  const normalized = normalizeTheme(theme);
  const serialized = JSON.stringify({
    ...normalized,
    variables: Object.fromEntries(
      Object.entries(resolveThemeVariables(normalized)).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0),
    ),
  }, null, 2) + "\n";
  if (new TextEncoder().encode(serialized).byteLength > MAX_THEME_JSON_BYTES) {
    throw new Error("The full theme exceeds 256 KiB. Remove variables before exporting.");
  }
  return serialized;
}
