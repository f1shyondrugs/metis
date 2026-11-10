/** Shared wire types, no account or database dependencies. */
export const NOTE_COLLABORATION_PATH = "/ws/notes";
export type NoteCollaborationUser = { id:string; name:string; color:string; username?:string; avatar?:string|null };
export type NoteCollaborationSession = {
  documentName:string; state:string; user:NoteCollaborationUser; projectId?:string; maxLength:number;
};
export function noteCollaborationName(id:string,generation:string) {
  return "note/"+encodeURIComponent(id)+"/"+generation;
}
export function parseNoteCollaborationName(name:string) {
  const parts=name.split("/");
  if(parts.length!==3||parts[0]!=="note"||!/^[a-f0-9]{32}$/.test(parts[2]))return null;
  try{const id=decodeURIComponent(parts[1]);return id && id.length<=200&&!/[\u0000-\u001f\u007f/\\]/.test(id)?{id,generation:parts[2]}:null;}catch{return null;}
}
