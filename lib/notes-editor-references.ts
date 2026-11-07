import { REFERENCE_KINDS, type ReferenceResult } from "./reference-search";
import { referenceHref } from "./reference-link";
/** Only a standalone @ at the caret; code and existing links are handled by the editor. */
export function notesReferenceQuery(textBefore:string) {
  const match=/(?:^|\s)@([^@\n]{0,100})$/.exec(textBefore);
  if(!match)return null;
  return {query:match[1],length:match[1].length+1};
}
export const NOTES_REFERENCE_KINDS=REFERENCE_KINDS;
export function notesReferenceHref(item:Pick<ReferenceResult,"kind"|"id"> & Partial<ReferenceResult>):string|null {
  return referenceHref(item);
}
