import { clientConfig } from "./client-config";
import { modelForSelection } from "./model-selection";
import { defaultParamsForModel, sanitizeModelParams, type ModelParameterModel, type ModelParamSelection } from "./model-params";

export const MODEL_STORAGE_KEY = `${clientConfig.storagePrefix}_model`;
export const PARAMS_STORAGE_KEY = `${clientConfig.storagePrefix}_model_params`;
type Model = ModelParameterModel & { id: string; legacyIds?: readonly string[] };
export type ClientModelPreferences = { modelParamsByModel?: Record<string, ModelParamSelection[]> };
type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

/** The same locally remembered selection used by New chat, never the legacy server default. */
export function latestClientModelSelection(models: readonly Model[], preferences: ClientModelPreferences, storage: Storage) {
  let remembered: string | null = null;
  let saved: ModelParamSelection[] | undefined;
  try {
    remembered = storage.getItem(MODEL_STORAGE_KEY);
    const raw = JSON.parse(storage.getItem(PARAMS_STORAGE_KEY) || "null");
    if (Array.isArray(raw)) saved = raw;
  } catch { /* A malformed/blocked local store uses discovered model defaults. */ }
  const selected = modelForSelection(models, remembered);
  const model = selected || models[0];
  if (!model) return null;
  const map = preferences.modelParamsByModel || {};
  const key = Object.hasOwn(map, model.id) ? model.id : remembered && selected && Object.hasOwn(map, remembered) ? remembered : null;
  const params = key ? map[key] : selected ? saved : undefined;
  return { modelId: model.id, modelParams: params === undefined ? defaultParamsForModel(model) : sanitizeModelParams(model, params) };
}

export function rememberClientModelSelection(selection: { modelId: string; modelParams: ModelParamSelection[] }, storage: Storage) {
  storage.setItem(MODEL_STORAGE_KEY, selection.modelId);
  storage.setItem(PARAMS_STORAGE_KEY, JSON.stringify(selection.modelParams));
}
