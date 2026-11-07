/** Public DTOs intentionally exclude account, project, chat, activity and asset metadata. */
export type PublicSharedAsset = { url: string; name: string; mimeType: string; size?: number };
export type PublicSharedTodo = { id: string; content: string; status: "pending" | "in_progress" | "completed" };

export type PublicSharedNote = {
  id: string;
  title: string;
  content: string;
  todos?: PublicSharedTodo[];
  kind?: "note" | "issuebook" | "project" | "image" | "file";
  parentId: string | null;
  sortKey: number;
  icon: string | null;
  fullWidth: boolean;
  cover?: string;
  asset?: PublicSharedAsset;
  createdAt: string;
  updatedAt: string;
};

export type PublicNoteShare = {
  rootId: string;
  notes: PublicSharedNote[];
  assets: Record<string, string>;
};

export type NoteShareLink = {
  active: boolean;
  passwordProtected: boolean;
  token: string;
  url: string;
  createdAt: string;
};
