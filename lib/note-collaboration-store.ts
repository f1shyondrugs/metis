import { randomBytes } from "node:crypto";
import * as Y from "yjs";
import { getDatabase, transaction } from "./sqlite";
import { getNote, updateNote, MAX_NOTE_CONTENT_LENGTH } from "./shared-context";
import { noteParticipantIdentity } from "./note-participant";
import { createNoteCollaborationDocument, noteCollaborationCandidate, MAX_NOTE_COLLAB_BYTES } from "./note-collaboration-document";
import { noteCollaborationName, parseNoteCollaborationName, type NoteCollaborationSession } from "./note-collaboration";
import type { SharedNote } from "./store";

type Row={note_id:string;generation:string;state:Uint8Array;content:string};
const initialized=new WeakSet<object>();
function database(){
  const db=getDatabase();
  if(!initialized.has(db)){db.exec("CREATE TABLE IF NOT EXISTS note_collaboration (note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,generation TEXT NOT NULL,state BLOB NOT NULL,content TEXT NOT NULL)");initialized.add(db);}
  return db;
}
export function editableCollaborationNote(id:string,userId:string) {
  const note=userId?getNote(id,userId):null;
  return note&&!note.archived&&note.kind!=="learned_fact"&&note.kind!=="issuebook"?note:null;
}
export function noteCollaborationRow(id:string) {
  return database().prepare("SELECT note_id,generation,state,content FROM note_collaboration WHERE note_id=?").get(id) as Row|undefined;
}
function ensure(note:SharedNote) {
  const old=noteCollaborationRow(note.id);
  if(old&&old.content===note.content)return old;
  const doc=createNoteCollaborationDocument(note.content);
  try{
    const state=Y.encodeStateAsUpdate(doc);if(state.byteLength>MAX_NOTE_COLLAB_BYTES)throw Error("This document is too large for live editing.");
    const row:Row={note_id:note.id,generation:randomBytes(16).toString("hex"),state,content:note.content};
    database().prepare("INSERT INTO note_collaboration(note_id,generation,state,content) VALUES(?,?,?,?) ON CONFLICT(note_id) DO UPDATE SET generation=excluded.generation,state=excluded.state,content=excluded.content").run(row.note_id,row.generation,row.state,row.content);
    return row;
  }finally{doc.destroy();}
}
export function getNoteCollaborationSession(id:string,user:{id:string;username:string}):NoteCollaborationSession|null {
  return transaction(()=>{
    const note=editableCollaborationNote(id,user.id);if(!note)return null;
    const row=ensure(note);
    return {documentName:noteCollaborationName(id,row.generation),state:Buffer.from(row.state).toString("base64"),user:noteParticipantIdentity(user),projectId:note.projectId,maxLength:note.issueId?100_000:MAX_NOTE_CONTENT_LENGTH};
  });
}
export function authorizeNoteCollaboration(name:string,userId:string) {
  const target=parseNoteCollaborationName(name);if(!target)return null;
  const note=editableCollaborationNote(target.id,userId),row=noteCollaborationRow(target.id);
  return note&&row&&row.generation===target.generation&&row.content===note.content?{note,row}:null;
}
/** Durable merge uses the latest SQLite snapshot, even if another socket is between validation and broadcast. */
export function commitNoteCollaborationUpdate(name:string,userId:string,update:Uint8Array) {
  return transaction(()=>{
    const resolved=authorizeNoteCollaboration(name,userId);
    if(!resolved)throw Error("Access was revoked or this document changed outside live editing. Your local changes are preserved.");
    const {note,row}=resolved;
    const next=noteCollaborationCandidate(row.state,update,note.issueId?100_000:MAX_NOTE_CONTENT_LENGTH);
    const saved=next.content===note.content?note:updateNote(note.id,{ownerId:userId,content:next.content,expectedVersion:note.version,author:"user"});
    if(!saved)throw Error("Note unavailable.");
    database().prepare("UPDATE note_collaboration SET state=?,content=? WHERE note_id=? AND generation=?").run(next.state,next.content,note.id,row.generation);
    return saved;
  });
}
