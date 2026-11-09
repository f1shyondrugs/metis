import { HocuspocusProvider, HocuspocusProviderWebsocket } from "@hocuspocus/provider";
/** A queued library reconnect must never resurrect a disposed editor. */
export class NoteCollaborationWebsocket extends HocuspocusProviderWebsocket {
  private disposed=false;
  connect():Promise<unknown> {return this.disposed?Promise.resolve():super.connect();}
  destroy(){this.disposed=true;super.destroy();}
}
/** Each connection owns its own presence; remote awareness is never retransmitted. */
export class NoteCollaborationProvider extends HocuspocusProvider {
  awarenessUpdateHandler(change:{added:number[];updated:number[];removed:number[]},origin:unknown) {
    const id=this.document.clientID;
    const own={added:change.added.filter(value=>value===id),updated:change.updated.filter(value=>value===id),removed:change.removed.filter(value=>value===id)};
    if(own.added.length||own.updated.length||own.removed.length)super.awarenessUpdateHandler(own,origin);
  }
}
