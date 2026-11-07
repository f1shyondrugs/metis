"use client";

import { BannerUpload } from "@/components/banner-upload";
import { uploadNoteBanner } from "@/lib/note-banner-upload";
export { NoteIconPicker } from "./note-icon-picker";

export function NoteBannerUpload({ noteId, value, onChange }: {
  noteId: string; value: string | null | undefined; onChange: (cover: string | null) => void;
}) {
  return <BannerUpload key={noteId} value={value} onChange={onChange}
    uploadFile={(file, signal) => uploadNoteBanner(noteId, file, signal)}/>;
}
