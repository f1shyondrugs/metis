import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { seal, unseal } from "./credential-envelope.mjs";
import { namedVaultMutation, type NamedVaultSummary, type VaultFieldSummary } from "../../lib/named-vault-contract";
import { ProtectedLoginError } from "../../lib/protected-login-errors";
import { consoleTargetInfo, type SavedLogin } from "../../lib/credential-vault";

type VaultRow = {
  id:string; title:string; kind:NamedVaultSummary["kind"]; target:string;
  revision:number; fields:string; envelope:string|null;
};

function summary(row: VaultRow): NamedVaultSummary {
  return {id:row.id,title:row.title,kind:row.kind,revision:row.revision,fields:JSON.parse(row.fields) as VaultFieldSummary[]};
}
function binding(row: Pick<VaultRow,"id"|"kind"|"target">) {
  return createHash("sha256").update(JSON.stringify(["named-vault",row.id,row.kind,row.target])).digest("hex");
}

/** The private credential engine owns this table. The app receives metadata only. */
export class NamedVaultEntries {
  constructor(private key:Buffer, private db:DatabaseSync) {
    db.exec(`CREATE TABLE IF NOT EXISTS named_vault_entries (
      owner TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, target TEXT NOT NULL,
      title TEXT NOT NULL, fields TEXT NOT NULL, envelope TEXT, revision INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (owner,id), UNIQUE (owner,kind,target)
    );`);
  }
  /** Additive migration: keep existing targets/envelopes and the original login paths. */
  syncBound(owner:string, entries:SavedLogin[]) {
    const expected = new Set<string>();
    const insert = this.db.prepare(`INSERT OR IGNORE INTO named_vault_entries
      (owner,id,kind,target,title,fields) VALUES (?,?,?,?,?,?)`);
    for(const entry of entries) {
      if (entry.kind === "console" && !consoleTargetInfo(entry.origin)) continue;
      const kind = entry.kind === "console" ? "console" : "browser";
      expected.add(JSON.stringify([kind,entry.origin]));
      const label = (entry.kind === "console" ? entry.label : entry.origin) || "Saved login";
      insert.run(owner,randomUUID(),kind,entry.origin,label.slice(0,120),"[]");
    }
    const stale = this.db.prepare("SELECT id,kind,target FROM named_vault_entries WHERE owner=? AND kind<>'custom'").all(owner);
    for (const row of stale) {
      if (!expected.has(JSON.stringify([row.kind,row.target]))) {
        this.db.prepare("DELETE FROM named_vault_entries WHERE owner=? AND id=?").run(owner,String(row.id));
      }
    }
  }
  requireBound(owner:string,id:string,kind:"browser"|"console",target?:string) {
    const entry = this.db.prepare("SELECT kind,target FROM named_vault_entries WHERE owner=? AND id=?").get(owner,id);
    if (!entry || entry.kind !== kind) throw new ProtectedLoginError("credential_unavailable");
    if (target !== undefined && entry.target !== target) throw new ProtectedLoginError("credential_binding_mismatch");
  }
  revokeBound(owner:string,kind:"browser"|"console",target:string) {
    this.db.prepare("DELETE FROM named_vault_entries WHERE owner=? AND kind=? AND target=?").run(owner,kind,target);
  }
  list(owner:string) {
    return (this.db.prepare("SELECT * FROM named_vault_entries WHERE owner=? ORDER BY title COLLATE NOCASE,id").all(owner) as VaultRow[]).map(summary);
  }
  mutate(owner:string, value:unknown): {entry?: NamedVaultSummary; status:"created"|"updated"|"deleted"} {
    const input = namedVaultMutation.parse(value);
    const existing = input.action === "create" ? undefined :
      this.db.prepare("SELECT * FROM named_vault_entries WHERE owner=? AND id=?").get(owner,input.id) as VaultRow|undefined;
    if(input.action !== "create" && !existing) throw new ProtectedLoginError("credential_unavailable");
    if(existing && "revision" in input && existing.revision !== input.revision) throw new ProtectedLoginError("credential_revision_changed");
    if(input.action === "delete") {
      if(existing?.kind !== "custom") throw new ProtectedLoginError("credential_bound_delete");
      this.db.prepare("DELETE FROM named_vault_entries WHERE owner=? AND id=? AND revision=?").run(owner,input.id,input.revision);
      return {status:"deleted"};
    }
    const id = existing?.id ?? randomUUID();
    const previous = existing?.envelope ? unseal(this.key,owner,binding(existing),existing.envelope) as Record<string,string> : {};
    const priorFields = new Map((existing ? summary(existing).fields : []).map(field=>[field.id,field]));
    const values: Record<string,string> = {};
    const fields = input.fields.map(item=>{
      const prior = item.id ? priorFields.get(item.id) : undefined;
      if (item.id && !prior) throw Error("Unknown vault field.");
      if ((!prior || prior.type !== item.type) && item.value === undefined) throw Error("Re-enter the value for new or retyped fields.");
      const fieldId = prior?.id ?? randomUUID();
      const text = item.value ?? previous[fieldId];
      if (typeof text !== "string") throw Error("Field value unavailable.");
      values[fieldId] = text;
      return {id:fieldId,name:item.name,type:item.type};
    });
    if (Object.values(values).reduce((size,value)=>size+value.length,0)>16_000)
      throw Error("Combined values are too large.");
    const row: VaultRow = {
      id,kind:existing?.kind ?? "custom",target:existing?.target ?? id,
      title:input.title,revision:(existing?.revision ?? 0)+1,fields:JSON.stringify(fields),envelope:null,
    };
    row.envelope = seal(this.key,owner,binding(row),values);
    if (existing) {
      this.db.prepare("UPDATE named_vault_entries SET title=?,fields=?,envelope=?,revision=? WHERE owner=? AND id=? AND revision=?")
        .run(row.title,row.fields,row.envelope,row.revision,owner,id,existing.revision);
    } else {
      this.db.prepare("INSERT INTO named_vault_entries(owner,id,kind,target,title,fields,envelope,revision) VALUES(?,?,?,?,?,?,?,?)")
        .run(owner,id,row.kind,row.target,row.title,row.fields,row.envelope,row.revision);
    }
    return {status:existing?"updated":"created",entry:summary(row)};
  }
}
