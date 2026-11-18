"use client";

import { createContext, useContext, type ReactNode } from "react";
import { PUBLIC_SHARE_URL_HINT, type PublicBaseUrl } from "@/lib/public-base-url";

const PublicBaseUrlContext = createContext<PublicBaseUrl>({ state: "unset" });

export function PublicBaseUrlProvider({ base, children }: { base: PublicBaseUrl; children: ReactNode }) {
  return <PublicBaseUrlContext.Provider value={base}>{children}</PublicBaseUrlContext.Provider>;
}

export function usePublicBaseUrl() {
  return useContext(PublicBaseUrlContext);
}

export function PublicShareUrlHint() {
  return <p className="text-sm text-muted-foreground">{PUBLIC_SHARE_URL_HINT}</p>;
}
