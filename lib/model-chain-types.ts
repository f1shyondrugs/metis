import type { ModelParamSelection } from "./model-params";

export type ModelChainStep = { modelId: string; modelParams: ModelParamSelection[] };
export type ModelChain = { id: string; name: string; steps: ModelChainStep[]; version: number; createdAt: string; updatedAt: string };
/** A run uses its own bounded snapshot; editing a chain cannot reroute an in-flight request. */
export type ModelChainRun = { id: string; name: string; version: number; steps: ModelChainStep[]; index: number; unavailableRetries: number };
