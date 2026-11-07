export type PaletteResults = {
    results: {
        chatId: string;
        chatTitle: string;
        updatedAt: string;
        messageId?: string;
        snippet: string;
        matchedKeywords?: string[];
    }[];
    notes: {
        noteId: string;
        title: string;
        snippet: string;
        updatedAt: string;
    }[];
    projects: {
        id: string;
        name: string;
        color: string;
        icon: string;
    }[];
    indexing: boolean;
};
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
const records = (value: unknown, max: number) => Array.isArray(value) ? value.slice(0, max).filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
/** Defense in depth: a bad/older response must not freeze the command palette. */
export function boundedSearchResults(value: unknown): PaletteResults {
    const data = value && typeof value === "object" ? value as Record<string, unknown> : {};
    const seenChats = new Set<string>();
    return {
        results: records(data.results, 50).filter(r => {
            if (typeof r.chatId !== "string" || !r.chatId || seenChats.has(r.chatId)) return false;
            seenChats.add(r.chatId);
            return true;
        }).slice(0, 30).map(r => ({
            chatId: text(r.chatId, 200), chatTitle: text(r.chatTitle, 200), updatedAt: text(r.updatedAt, 80),
            ...(typeof r.messageId === "string" ? { messageId: text(r.messageId, 200) } : {}),
            snippet: text(r.snippet, 400), matchedKeywords: Array.isArray(r.matchedKeywords) ? r.matchedKeywords.filter((k): k is string => typeof k === "string").slice(0, 5).map(k => k.slice(0, 120)) : [],
        })),
        notes: records(data.notes, 8).filter(n => typeof n.noteId === "string").map(n => ({ noteId: text(n.noteId, 200), title: text(n.title, 200), snippet: text(n.snippet, 400), updatedAt: text(n.updatedAt, 80) })),
        projects: records(data.projects, 8).filter(p => typeof p.id === "string").map(p => ({ id: text(p.id, 200), name: text(p.name, 200), color: text(p.color, 40), icon: text(p.icon, 80) })),
        indexing: data.indexing === true,
    };
}
