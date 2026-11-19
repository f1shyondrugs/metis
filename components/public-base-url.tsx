"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { PUBLIC_SHARE_URL_HINT, type PublicBaseUrl } from "@/lib/public-base-url";

const PublicBaseUrlContext = createContext<{ base: PublicBaseUrl; update: (base: PublicBaseUrl) => void }>({
  base: { state: "unset" }, update: () => {},
});

export function PublicBaseUrlProvider({ base, children }: { base: PublicBaseUrl; children: ReactNode }) {
  const [updated, update] = useState<PublicBaseUrl | null>(null);
  return <PublicBaseUrlContext.Provider value={{ base: updated ?? base, update }}>{children}</PublicBaseUrlContext.Provider>;
}

export function usePublicBaseUrl() {
  return useContext(PublicBaseUrlContext).base;
}

export function useUpdatePublicBaseUrl() {
  return useContext(PublicBaseUrlContext).update;
}

export function PublicShareUrlHint() {
  return <p className="text-sm text-muted-foreground">{PUBLIC_SHARE_URL_HINT}</p>;
}
