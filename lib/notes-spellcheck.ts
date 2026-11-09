export const NOTES_SPELLCHECK_CHOICES = [
  ["auto","Browser default"],["off","Off"],["de-DE","German"],["en-US","English (US)"],
  ["en-GB","English (UK)"],["fr-FR","French"],["es-ES","Spanish"],["it-IT","Italian"],["nl-NL","Dutch"],["pl-PL","Polish"],
] as const;
export type NotesSpellcheckChoice = typeof NOTES_SPELLCHECK_CHOICES[number][0];
export function notesSpellcheckChoice(value: unknown): NotesSpellcheckChoice {
  return NOTES_SPELLCHECK_CHOICES.some(([id]) => id === value) ? value as NotesSpellcheckChoice : "auto";
}
export function notesSpellcheckAttributes(choice: NotesSpellcheckChoice) {
  return {spellcheck: choice === "off" ? "false" : "true", ...(choice === "off" || choice === "auto" ? {} : {lang:choice})};
}
