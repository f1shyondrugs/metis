import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { SharedNotePasswordGate } from "@/components/notes/shared-note-password-gate";
import { getSharedNote, getSharedNoteAccess, noteShareCookieName } from "@/lib/note-sharing";
import { SharedNoteTree } from "@/components/notes/shared-note-tree";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Shared notes",
  robots: {index:false,follow:false,noarchive:true},
  referrer: "no-referrer",
};

export default async function SharedNotePage({params}:{params:Promise<{token:string}>}) {
  const {token}=await params;
  const credential=(await cookies()).get(noteShareCookieName(token))?.value;
  const access=getSharedNoteAccess(token,credential);
  if(access==="not_found")notFound();
  if(access==="password_required")return <SharedNotePasswordGate token={token}/>;
  const share=getSharedNote(token,credential);
  if(!share)notFound();
  return <SharedNoteTree token={token} initialShare={share}/>;
}
