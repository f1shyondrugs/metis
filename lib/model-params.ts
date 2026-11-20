/**
 * Shared model-parameter definitions. Kept out of route files so the values
 * can be imported by both the models API route and the UI without tripping
 * Next's route-module type checks (which forbid non-route exports).
 */

import { contextWindowForModel } from "./context-window";
import type { NumericModelParameter, ProviderModelParameter } from "./providers/types";

export type ModelParamValue = {
  value: string;
  displayName?: string;
};

export type ModelParameter = {
  id: string;
  displayName?: string;
  values: ModelParamValue[];
  customNumber?: NumericModelParameter;
};

export type ModelParamSelection = {
  id: string;
  value: string;
};

export type ModelParameterModel = {
  id?: string;
  displayName?: string;
  providerId?: string;
  contextWindow?: number;
  capabilities?: Record<string, boolean>;
  parameters?: ReadonlyArray<ProviderModelParameter>;
  defaultParams?: ReadonlyArray<ModelParamSelection>;
  variants?: ReadonlyArray<ReadonlyArray<ModelParamSelection>>;
};

/** Missing selections remain unknown; do not invent a provider default. */
export function selectedReasoning(params?: ReadonlyArray<ModelParamSelection>): string | null {
  return params?.find(param => param.id === "effort")?.value
    ?? params?.find(param => param.id === "reasoning")?.value
    ?? null;
}

export function modelParamsEqual(
  left?: ReadonlyArray<ModelParamSelection>,
  right?: ReadonlyArray<ModelParamSelection>,
): boolean {
  const normalize = (items?: ReadonlyArray<ModelParamSelection>) =>
    (items || [])
      .map(item => ({ id: item.id.trim(), value: item.value }))
      .filter(item => item.id)
      .sort((a, b) => a.id.localeCompare(b.id) || a.value.localeCompare(b.value));
  const a = normalize(left);
  const b = normalize(right);
  return a.length === b.length && a.every((item, index) =>
    item.id === b[index]?.id && item.value === b[index]?.value,
  );
}

const REASONING_IDS = new Set(["effort", "reasoning"]);
const CONTEXT_IDS = new Set(["context", "contextWindow", "context_window"]);
const REMOVED_PARAM_IDS = new Set(["uncensored"]);

export function selectedContext(params?: ReadonlyArray<ModelParamSelection>): string | null {
  return params?.find(param => CONTEXT_IDS.has(param.id))?.value || null;
}

function canonicalParamId(id: string): string {
  if (CONTEXT_IDS.has(id)) return "context";
  if (id === "reasoning") return "effort";
  return id;
}

function parameterRank(id: string): number {
  if (id === "context") return 0;
  if (REASONING_IDS.has(id)) return 1;
  if (id === "fast" || id === "speed") return 3;
  return 2;
}

function orderModelParams<T extends { id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => parameterRank(a.id) - parameterRank(b.id));
}

/** Drops retired params (e.g. leftover `uncensored` in stored chat/settings). */
export function stripRemovedModelParams<T extends { id: string }>(
  params?: T[] | null,
): T[] | undefined {
  if (!Array.isArray(params)) return undefined;
  return params.filter((param) => !REMOVED_PARAM_IDS.has(param.id));
}

function finiteContextWindow(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : undefined;
}

function contextValueTokens(value: string): number | undefined {
  const normalized = value.trim().toLowerCase().replace(/,/g, "");
  if (normalized === "max" || normalized === "unlimited") return undefined;
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([km])?$/);
  if (!match) return undefined;
  const amount = Number(match[1]);
  const multiplier = match[2] === "m" ? 1_000_000 : match[2] === "k" ? 1_000 : 1;
  const tokens = Math.round(amount * multiplier);
  return Number.isFinite(tokens) && tokens > 0 ? tokens : undefined;
}

function contextLabel(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000 * 100) / 100}M`;
  return `${Math.round(value / 1_000)}K`;
}

export function contextParameterForModel(
  contextWindow?: number,
  concreteValues?: ReadonlyArray<ModelParamValue>,
): ModelParameter | null {
  const max = finiteContextWindow(contextWindow);
  const normalizedConcrete = (concreteValues || [])
    .map((entry) => {
      const value = typeof entry?.value === "string" ? entry.value.trim() : "";
      if (!value) return null;
      const normalized = value.toLowerCase();
      if (normalized === "max" || normalized === "unlimited") {
        return {
          value: normalized,
          ...(entry.displayName
            ? { displayName: entry.displayName }
            : max
              ? { displayName: contextLabel(max) }
              : {}),
        };
      }
      const tokens = contextValueTokens(value);
      return tokens ? { value, ...(entry.displayName ? { displayName: entry.displayName } : {}) } : null;
    })
    .filter((entry): entry is ModelParamValue => Boolean(entry))
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.value === entry.value) === index);

  // T3-style behavior: a known context limit is metadata for the meter and
  // compaction, not permission to fabricate a context selector. Only expose
  // choices that the provider/CLI actually advertised.
  if (!normalizedConcrete.length) return null;
  return { id: "context", displayName: "Context", values: normalizedConcrete };
}

function cloneParameter(parameter: ProviderModelParameter): ModelParameter {
  return {
    id: canonicalParamId(parameter.id),
    displayName: REASONING_IDS.has(parameter.id) ? "Reasoning" : CONTEXT_IDS.has(parameter.id) && !parameter.customNumber ? "Context" : parameter.displayName,
    values: parameter.values.map((value) => ({ ...value })),
    ...(parameter.customNumber ? { customNumber: { ...parameter.customNumber } } : {}),
  };
}

export function modelParametersForModel(model: ModelParameterModel): ModelParameter[] {
  const parameters: ModelParameter[] = [];
  const seen = new Set<string>();

  // Context is ordered at the very top, before thinking effort and other parameters.
  const contextDefinition = model.parameters?.find((parameter) => CONTEXT_IDS.has(parameter.id));
  const variantContextValues = (model.variants || [])
    .flatMap((variant) => variant)
    .filter((parameter) => CONTEXT_IDS.has(parameter.id))
    .map((parameter) => ({ value: parameter.value }));
  const inferredWindow = finiteContextWindow(model.contextWindow) ?? contextWindowForModel({
    id: model.id,
    displayName: model.displayName,
    contextWindow: model.contextWindow,
  });
  const context = contextDefinition?.customNumber
    ? cloneParameter(contextDefinition)
    : contextParameterForModel(inferredWindow, [
    ...(contextDefinition?.values || []),
    ...variantContextValues,
  ]);
  if (context && !seen.has("context")) {
    parameters.push(context);
    seen.add("context");
  }

  for (const raw of model.parameters || []) {
    if (CONTEXT_IDS.has(raw.id) || REMOVED_PARAM_IDS.has(raw.id)) continue;
    const parameter = cloneParameter(raw);
    if (seen.has(parameter.id) || REMOVED_PARAM_IDS.has(parameter.id)) continue;
    seen.add(parameter.id);
    parameters.push(parameter);
  }

  return orderModelParams(parameters);
}

export function defaultParamsForModel(model: ModelParameterModel): ModelParamSelection[] {
  const parameters = modelParametersForModel(model);
  const allowed = new Map(parameters.map((parameter) => [parameter.id, parameter]));
  const result: ModelParamSelection[] = [];
  for (const param of model.defaultParams || []) {
    const id = canonicalParamId(param.id);
    if (REMOVED_PARAM_IDS.has(id)) continue;
    const definition = allowed.get(id);
    if (!definition) continue;
    const value = normalizeParameterValue(definition, param.value);
    if (value === undefined) continue;
    result.push({ id, value });
  }
  return orderModelParams(result);
}

/** Expand suffixed decimals without floating-point rounding or accepting partial tokens. */
function expandWholeNumber(value: string, allowMagnitudeSuffix?: boolean): string | undefined {
  const input = value.trim();
  if (/^\d+$/.test(input)) return input;
  if (!allowMagnitudeSuffix) return undefined;
  const match = /^(\d+)(?:\.(\d+))?\s*([km])$/i.exec(input);
  if (!match) return undefined;
  const places = match[3].toLowerCase() === "m" ? 6 : 3;
  const fraction = match[2] ?? "";
  if (/[^0]/.test(fraction.slice(places))) return undefined;
  return match[1] + fraction.slice(0, places).padEnd(places, "0");
}

/** Validate custom values once for UI, persistence and the native adapter. */
export function normalizeParameterValue(definition: ModelParameter, value: string): string | undefined {
  if (definition.values.some(option => option.value === value)) return value;
  const number = definition.customNumber;
  if (!number) return undefined;
  const whole = expandWholeNumber(value, number.allowMagnitudeSuffix);
  if (whole === undefined) return undefined;
  const parsed = Number(whole);
  return Number.isSafeInteger(parsed) && parsed >= number.min && parsed <= number.max
    && (parsed - number.min) % number.step === 0 ? String(parsed) : undefined;
}

export function sanitizeModelParams(
  model: ModelParameterModel,
  params?: ReadonlyArray<ModelParamSelection> | null,
): ModelParamSelection[] {
  const allowed = new Map(modelParametersForModel(model).map((parameter) => [parameter.id, parameter]));
  const result: ModelParamSelection[] = [];
  for (const raw of params || []) {
    if (!raw || typeof raw.id !== "string" || typeof raw.value !== "string") continue;
    const id = canonicalParamId(raw.id);
    if (REMOVED_PARAM_IDS.has(id)) continue;
    const definition = allowed.get(id);
    if (!definition) continue;
    const value = normalizeParameterValue(definition, raw.value);
    if (value === undefined) continue;
    result.push({ id, value });
  }
  return orderModelParams(result);
}

export function providerNativeParams(
  params?: ReadonlyArray<ModelParamSelection> | null,
  options?: { includeContext?: boolean },
): ModelParamSelection[];
export function providerNativeParams(
  model: ModelParameterModel,
  params?: ReadonlyArray<ModelParamSelection> | null,
  options?: { includeContext?: boolean },
): ModelParamSelection[];
export function providerNativeParams(
  modelOrParams?: ModelParameterModel | ReadonlyArray<ModelParamSelection> | null,
  paramsOrOptions?: ReadonlyArray<ModelParamSelection> | { includeContext?: boolean } | null,
  maybeOptions?: { includeContext?: boolean },
): ModelParamSelection[] {
  const isSelectionArray = (value: unknown): value is ReadonlyArray<ModelParamSelection> => Array.isArray(value);
  const directSelections = isSelectionArray(modelOrParams);
  const selections = directSelections
    ? modelOrParams
    : modelOrParams
      ? sanitizeModelParams(modelOrParams, isSelectionArray(paramsOrOptions) ? paramsOrOptions : undefined)
      : [];
  const options = directSelections
    ? (paramsOrOptions && !isSelectionArray(paramsOrOptions) ? paramsOrOptions : maybeOptions)
    : maybeOptions;
  return selections
    .map((param) => ({ ...param, id: canonicalParamId(param.id) }))
    .filter((param) => (options?.includeContext || param.id !== "context") && !REMOVED_PARAM_IDS.has(param.id));
}
