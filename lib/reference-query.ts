import type { ReferenceKind } from "./reference-search";

/** Reserved category names only: arbitrary titles and unknown prefixes stay literal. */
export const REFERENCE_SHORTCUTS: Record<ReferenceKind, string> = {
  file:"files", canvas:"canvases", plan:"plans", note:"notes", issue:"issues",
  browser:"browser", terminal:"terminals", memory:"memories", chat:"chats",
};
const aliases: Record<string, ReferenceKind> = {
  file:"file",files:"file",dateien:"file",canvas:"canvas",canvases:"canvas",
  plan:"plan",plans:"plan",pläne:"plan",note:"note",notes:"note",notizen:"note",
  issue:"issue",issues:"issue",browser:"browser",terminal:"terminal",terminals:"terminal",
  memory:"memory",memories:"memory",erinnerungen:"memory",chat:"chat",chats:"chat",
};

/** Search scope is separate from the raw mention, preserving replacement/caret offsets. */
export function resolveReferenceQuery(raw: string, selectedKind: ReferenceKind | null = null) {
  const match = /^@?([^:\s]+)(?::([\s\S]*)|\s*)$/u.exec(raw);
  const alias = match?.[1].toLocaleLowerCase("en");
  const kind = alias && Object.hasOwn(aliases,alias) ? aliases[alias] : undefined;
  return kind ? {kind, query:(match![2] || "").trimStart()} : {kind:selectedKind, query:raw};
}
