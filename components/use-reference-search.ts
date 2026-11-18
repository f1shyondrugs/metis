"use client";
import { useEffect, useMemo, useState } from "react";
import { createReferenceLookup, uniqueChatReferences, type ReferenceResult, type ReferenceKind, type ReferenceSearchState } from "@/lib/reference-search";

export function useReferenceSearch<T extends ReferenceResult>({ enabled, chatId, projectId, kind, kinds, query }: {
  enabled: boolean; chatId?: string | null; projectId?: string | null; kind?: ReferenceKind | null; kinds?:readonly ReferenceKind[]; query: string;
}) {
  const lookup = useMemo(() => createReferenceLookup<T>(), []);
  const [state, setState] = useState<ReferenceSearchState<T> | null>(null);
  const [retry, setRetry] = useState(0);
  const kindsKey=kinds?.join(",") || "";
  const key = JSON.stringify([chatId || "", projectId || "", kind || "", kindsKey, query, retry]);
  useEffect(() => {
    if (!enabled) { lookup.cancel(); setState(null); return; }
    const timer = window.setTimeout(() => { void lookup.load({ chatId, projectId, kind, kinds:kindsKey ? kindsKey.split(",") as ReferenceKind[] : undefined, query, key }, setState); }, 120);
    return () => { window.clearTimeout(timer); lookup.cancel(); };
  }, [enabled, chatId, projectId, kind, kindsKey, query, key, lookup]);
  const current = enabled && state?.key === key ? state : null;
  const results = useMemo(() => uniqueChatReferences(current?.results || []), [current?.results]);
  return {
    results,
    loading: enabled && (!current || current.status === "loading"),
    indexing: Boolean(current?.indexing),
    notice: current?.notice,
    error: current?.status === "error" ? current.error : undefined,
    retry: () => setRetry(value => value + 1),
  };
}
