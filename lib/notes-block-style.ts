export const NOTE_BLOCK_COLORS = {
  gray: "#9ca3af", red: "#ef4444", orange: "#f97316", yellow: "#eab308",
  green: "#22c55e", blue: "#3b82f6", purple: "#a855f7", pink: "#ec4899",
} as const;
export type NoteBlockColor = keyof typeof NOTE_BLOCK_COLORS;
export function isNoteBlockColor(value: unknown): value is NoteBlockColor {
  return typeof value === "string" && Object.hasOwn(NOTE_BLOCK_COLORS, value);
}
export function noteBlockStyle(value: unknown) {
  return isNoteBlockColor(value) ? { borderInlineStart: "3px solid " + NOTE_BLOCK_COLORS[value], paddingInlineStart: "12px" } : undefined;
}
