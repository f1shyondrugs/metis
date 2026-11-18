"use client";

import { useEffect, useRef } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ChatListLoadMore({ hasMore, loading, error, onLoadMore, onRetry }: {
  hasMore: boolean;
  loading: boolean;
  error: string;
  onLoadMore: () => void;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || !hasMore || loading || error || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) onLoadMore();
    }, { root: node.closest(".metis-sidebar-scroll"), rootMargin: "0px 0px 120px 0px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, loading, error, onLoadMore]);
  if (!hasMore && !loading && !error) return null;
  return <div ref={ref} className="px-2 py-2 text-center">
    {error ? <div role="alert" className="text-xs text-destructive">
      <p>{error}</p>
      <Button variant="ghost" size="sm" onClick={onRetry}>Retry loading chats</Button>
    </div> : loading ? <div role="status" aria-label="Loading more chats" className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
      <LoaderCircle className="size-3.5 animate-spin" />Loading chats…
    </div> : <Button variant="ghost" size="sm" onClick={onLoadMore}>Load more chats</Button>}
  </div>;
}
