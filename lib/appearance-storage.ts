import { createClientId } from "./client-id";
import {
  DEFAULT_THEME_ID,
  MAX_THEME_JSON_BYTES,
  THEME_PRESETS,
  getThemePreset,
  isValidThemeVariableName,
  normalizeTheme,
  resolveThemeVariables,
  type ThemeDefinition,
} from "./appearance-theme";

export const APPEARANCE_STORAGE_KEY = "metis-themes-v1";
export const LEGACY_APPEARANCE_STORAGE_KEY = "metis-appearance";
export const MAX_CUSTOM_THEMES = 20;
export const MAX_APPEARANCE_STATE_BYTES = 512 * 1024;
export const APPLIED_THEME_VARIABLES_ATTRIBUTE = "data-metis-theme-vars";

export interface CustomAppearanceTheme {
  id: string;
  theme: ThemeDefinition;
}

export interface AppearanceState {
  version: 1;
  selected: string;
  customThemes: CustomAppearanceTheme[];
}

const CUSTOM_THEME_ID = /^custom-[a-z0-9][a-z0-9-]{0,95}$/;
const POLLUTION_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const appliedVariables = new WeakMap<HTMLElement, string[]>();

export function createDefaultAppearanceState(): AppearanceState {
  return { version: 1, selected: DEFAULT_THEME_ID, customThemes: [] };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return (prototype === Object.prototype || prototype === null) &&
    !Object.keys(value).some((key) => POLLUTION_KEYS.has(key));
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeStoredTheme(value: unknown): ThemeDefinition {
  if (!isRecord(value)) throw new Error("Invalid saved theme.");
  const theme = normalizeTheme(value);
  if (byteLength(JSON.stringify(theme)) > MAX_THEME_JSON_BYTES) {
    throw new Error("A saved theme must be no larger than 256 KiB.");
  }
  return theme;
}

function hasTheme(state: AppearanceState, id: string): boolean {
  return Boolean(getThemePreset(id)) || state.customThemes.some((item) => item.id === id);
}

export interface AppearanceStorageConfig {
  storageKey: string;
  legacyStorageKey: string;
  maxStateBytes: number;
  maxThemes: number;
  maxThemeBytes: number;
  defaultThemeId: string;
  presetIds: readonly string[];
  customThemeIdPattern: string;
}

export const APPEARANCE_STORAGE_CONFIG: AppearanceStorageConfig = {
  storageKey: APPEARANCE_STORAGE_KEY,
  legacyStorageKey: LEGACY_APPEARANCE_STORAGE_KEY,
  maxStateBytes: MAX_APPEARANCE_STATE_BYTES,
  maxThemes: MAX_CUSTOM_THEMES,
  maxThemeBytes: MAX_THEME_JSON_BYTES,
  defaultThemeId: DEFAULT_THEME_ID,
  presetIds: THEME_PRESETS.map((theme) => theme.id),
  customThemeIdPattern: CUSTOM_THEME_ID.source,
};

/**
 * Keep this function closure-free: the pre-paint script uses its exact source
 * with the same config and theme validator as the hydrated application. Avoid
 * nested functions/callbacks, which build tools may wrap in module helpers.
 */
export function readAppearanceStateForBootstrap(
  storage: Pick<Storage, "getItem">,
  config: AppearanceStorageConfig,
  normalize: (input: unknown) => ThemeDefinition,
): AppearanceState {
  let json: string | null = null;
  try { json = storage.getItem(config.storageKey); } catch { /* Storage can be disabled. */ }
  if (json && json.length <= config.maxStateBytes &&
    new TextEncoder().encode(json).byteLength <= config.maxStateBytes) {
    try {
      const value: unknown = JSON.parse(json);
      if (value && typeof value === "object" && !Array.isArray(value)) {
        const record = value as Record<string, unknown>;
        const prototype = Object.getPrototypeOf(record);
        let safe = prototype === Object.prototype || prototype === null;
        for (const key of Object.keys(record)) {
          if (key === "__proto__" || key === "constructor" || key === "prototype") safe = false;
        }
        if (safe && record.version === 1 && Array.isArray(record.customThemes)) {
          const state: AppearanceState = { version: 1, selected: config.defaultThemeId, customThemes: [] };
          const ids = new Set<string>();
          const idPattern = new RegExp(config.customThemeIdPattern);
          for (const item of record.customThemes) {
            if (state.customThemes.length >= config.maxThemes) break;
            if (!item || typeof item !== "object" || Array.isArray(item)) continue;
            const itemPrototype = Object.getPrototypeOf(item);
            let itemSafe = itemPrototype === Object.prototype || itemPrototype === null;
            for (const key of Object.keys(item)) {
              if (key === "__proto__" || key === "constructor" || key === "prototype") itemSafe = false;
            }
            if (!itemSafe || typeof item.id !== "string" || !idPattern.test(item.id) ||
              ids.has(item.id) || !item.theme || typeof item.theme !== "object" || Array.isArray(item.theme)) continue;
            const themePrototype = Object.getPrototypeOf(item.theme);
            let themeSafe = themePrototype === Object.prototype || themePrototype === null;
            for (const key of Object.keys(item.theme)) {
              if (key === "__proto__" || key === "constructor" || key === "prototype") themeSafe = false;
            }
            if (!themeSafe) continue;
            try {
              const theme = normalize(item.theme);
              if (new TextEncoder().encode(JSON.stringify(theme)).byteLength > config.maxThemeBytes) continue;
              state.customThemes.push({ id: item.id, theme });
              ids.add(item.id);
            } catch {
              // Keep the remaining independent theme records.
            }
          }
          if (typeof record.selected === "string") {
            let exists = config.presetIds.includes(record.selected);
            for (const item of state.customThemes) if (item.id === record.selected) exists = true;
            if (exists) state.selected = record.selected;
          }
          return state;
        }
      }
    } catch {
      // A legacy choice can still be recovered if the new record was corrupted.
    }
  }
  let legacy: string | null = null;
  try { legacy = storage.getItem(config.legacyStorageKey); } catch { /* Storage can be disabled. */ }
  return {
    version: 1,
    selected: legacy === "graphite" || legacy === "midnight" ? legacy : config.defaultThemeId,
    customThemes: [],
  };
}

/** Read-only migration: the next successful user change writes the current format. */
export function readAppearanceState(storage: Pick<Storage, "getItem">): AppearanceState {
  return readAppearanceStateForBootstrap(storage, APPEARANCE_STORAGE_CONFIG, normalizeTheme);
}

export function normalizeAppearanceState(input: unknown): AppearanceState {
  if (!isRecord(input)) throw new Error("Invalid appearance state.");
  const state = input;
  if (!isRecord(state) || state.version !== 1 || typeof state.selected !== "string" ||
    !Array.isArray(state.customThemes) || state.customThemes.length > MAX_CUSTOM_THEMES) {
    throw new Error("Invalid appearance state, or too many custom themes.");
  }
  const ids = new Set<string>();
  const customThemes = state.customThemes.map((item) => {
    if (!isRecord(item) || typeof item.id !== "string" || !CUSTOM_THEME_ID.test(item.id)) {
      throw new Error("Custom theme IDs must start with custom- and contain lowercase letters, numbers, or hyphens.");
    }
    if (ids.has(item.id)) throw new Error("Custom theme IDs must be unique.");
    ids.add(item.id);
    return { id: item.id, theme: normalizeStoredTheme(item.theme) };
  });
  // Retired built-in selection migrates without discarding account custom themes or revisions.
  const normalized: AppearanceState = { version: 1, selected: state.selected === "metis" ? DEFAULT_THEME_ID : state.selected, customThemes };
  if (!hasTheme(normalized, normalized.selected)) throw new Error("The selected theme does not exist.");
  stateJson(normalized);
  return normalized;
}

function stateJson(state: AppearanceState): string {
  const json = JSON.stringify(state);
  if (byteLength(json) > MAX_APPEARANCE_STATE_BYTES) {
    throw new Error("Saved themes exceed the 512 KiB storage limit. Delete an unused custom theme first.");
  }
  return json;
}

/** Save before updating React or the DOM. Quota/security failures deliberately propagate. */
export function persistAppearanceState(storage: Pick<Storage, "setItem">, state: AppearanceState): void {
  storage.setItem(APPEARANCE_STORAGE_KEY, stateJson(normalizeAppearanceState(state)));
}

export function getSelectedTheme(state: AppearanceState): ThemeDefinition {
  return getThemePreset(state.selected) ??
    state.customThemes.find((item) => item.id === state.selected)?.theme ??
    getThemePreset(DEFAULT_THEME_ID)!;
}

export function createCustomTheme(state: AppearanceState, theme: ThemeDefinition, id?: string): AppearanceState {
  if (state.customThemes.length >= MAX_CUSTOM_THEMES) {
    throw new Error("You can save up to " + MAX_CUSTOM_THEMES + " custom themes. Delete one before adding another.");
  }
  const customId = id ?? "custom-" + createClientId();
  if (!CUSTOM_THEME_ID.test(customId) || hasTheme(state, customId)) {
    throw new Error("The custom theme ID is invalid or already exists.");
  }
  const next: AppearanceState = {
    version: 1,
    selected: customId,
    customThemes: [...state.customThemes, { id: customId, theme: normalizeStoredTheme(theme) }],
  };
  stateJson(next);
  return next;
}

/** Replace and select one saved custom theme without consuming another slot. */
export function updateCustomTheme(state: AppearanceState, id: string, theme: ThemeDefinition): AppearanceState {
  if (!CUSTOM_THEME_ID.test(id) || !state.customThemes.some((item) => item.id === id)) {
    throw new Error("The custom theme does not exist.");
  }
  const normalized = normalizeStoredTheme(theme);
  const next: AppearanceState = {
    version: 1,
    selected: id,
    customThemes: state.customThemes.map((item) => item.id === id ? { id, theme: normalized } : item),
  };
  stateJson(next);
  return next;
}

export function selectAppearanceTheme(state: AppearanceState, id: string): AppearanceState {
  if (!hasTheme(state, id)) throw new Error("The selected theme does not exist.");
  return state.selected === id ? state : { ...state, selected: id };
}

export function deleteCustomTheme(state: AppearanceState, id: string): AppearanceState {
  if (getThemePreset(id)) throw new Error("Built-in themes cannot be deleted.");
  if (!state.customThemes.some((item) => item.id === id)) return state;
  return {
    version: 1,
    selected: state.selected === id ? DEFAULT_THEME_ID : state.selected,
    customThemes: state.customThemes.filter((item) => item.id !== id),
  };
}

function previousVariableNames(root: HTMLElement): string[] {
  const known = appliedVariables.get(root);
  if (known) return known;
  const saved = root.getAttribute(APPLIED_THEME_VARIABLES_ATTRIBUTE);
  if (!saved || saved.length > MAX_APPEARANCE_STATE_BYTES) return [];
  try {
    const names: unknown = JSON.parse(saved);
    return Array.isArray(names) ? names.filter((name): name is string =>
      typeof name === "string" && isValidThemeVariableName(name)) : [];
  } catch {
    return [];
  }
}

/** Own only the properties recorded here; unrelated root styles are preserved. */
export function applyAppearanceTheme(root: HTMLElement, theme: ThemeDefinition, themeId: string): void {
  const normalized = normalizeTheme(theme);
  const variables = resolveThemeVariables(normalized);
  const names = Object.keys(variables);
  for (const name of previousVariableNames(root)) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(variables)) root.style.setProperty(name, value);
  root.classList.toggle("dark", normalized.mode === "dark");
  root.setAttribute("data-surface", themeId);
  root.setAttribute(APPLIED_THEME_VARIABLES_ATTRIBUTE, JSON.stringify(names));
  root.style.colorScheme = normalized.mode;
  appliedVariables.set(root, names);
}
