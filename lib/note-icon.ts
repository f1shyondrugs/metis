import { normalizeProjectColor, projectIconName, searchProjectIcons } from "@/lib/project-appearance";

export type NoteIconValue = { kind: "lucide"; name: string; color: string | null } | { kind: "emoji"; text: string };

/** Keep legacy Unicode/text icons intact; structured glyphs stay in the existing icon field. */
export function parseNoteIcon(value: string | null | undefined): NoteIconValue | null {
  if (!value) return null;
  if (!value.startsWith("lucide:")) return { kind: "emoji", text: value };
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) return null;
  const name = projectIconName("lucide:" + parts[1]);
  const color = parts.length === 3 ? normalizeProjectColor(parts[2]) : null;
  if (!name || (parts.length === 3 && !color)) return null;
  return { kind: "lucide", name, color };
}

export function searchNoteIcons(query: string): string[] {
  return searchProjectIcons(query.replace(/\bchecks\b/gi, "check"));
}

export function noteLucideIcon(name: string, color?: string | null): string | null {
  const canonical = projectIconName("lucide:" + name);
  if (!canonical) return null;
  const normalized = color ? normalizeProjectColor(color) : null;
  if (color && !normalized) return null;
  return "lucide:" + canonical + (normalized ? ":" + normalized : "");
}
