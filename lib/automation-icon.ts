import {parseNoteIcon,noteLucideIcon} from "./note-icon";
/** Same native glyph/color and Unicode format as pages; never an arbitrary image/URL. */
export function normalizeAutomationIcon(value:unknown):string|null{
 if(value==null||value==="")return null;
 if(typeof value!=="string"||value.length>100||/[\u0000-\u001f\u007f]/u.test(value))throw Error("Choose a valid automation icon.");
 const icon=parseNoteIcon(value);
 if(!icon)throw Error("Choose a valid automation icon.");
 if(icon.kind==="emoji"&&[...new Intl.Segmenter("en",{granularity:"grapheme"}).segment(icon.text)].length!==1)throw Error("Choose a single automation icon.");
 return icon.kind==="lucide"?noteLucideIcon(icon.name,icon.color):icon.text;
}
export function automationIconPatch(body:Record<string,unknown>){return Object.hasOwn(body,"icon")?{icon:normalizeAutomationIcon(body.icon)}:{};}
