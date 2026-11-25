export const USER_INPUT_TRANSPORT_TIMEOUT_MS: number;
export function awaitUserQuestionGate(options: { context: Record<string, unknown>; url: string; token: string; leaseHeaders: Record<string, string>; signal?: AbortSignal; dispatcher?: import("undici").Dispatcher; fetcher?: typeof fetch }): Promise<import("./host-tool-policy.mjs").HostToolPolicy | undefined>;
export function withUserQuestionBarrier<T>(name: string, context: Record<string, unknown>, execute: () => Promise<T>, signal?: AbortSignal): Promise<T>;
