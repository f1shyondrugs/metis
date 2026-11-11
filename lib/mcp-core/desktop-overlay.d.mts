export const OVERLAY_MAX_BYTES: number;
export const OVERLAY_MAX_ITEMS: number;
export const OVERLAY_OPERATIONS: readonly string[];
export function assertOverlayJson(value: unknown): void;
export function normalizeDesktopOverlay(input: unknown, options?: { tool?: boolean }): Record<string, unknown>;
export function summarizeDesktopOverlay(value: unknown): Record<string, unknown>;
export const DESKTOP_OVERLAY_INPUT_SCHEMA: {
  type: string;
  properties: Record<string, unknown>;
  required: string[];
  additionalProperties: boolean;
};
