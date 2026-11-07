"use client";

import { createContext, useContext } from "react";
import type { PublicMarkdownShare } from "@/lib/public-markdown";

/** Includes nested artifact cards and dialogs; public previews never inherit account navigation. */
export const PublicMarkdownContext = createContext<PublicMarkdownShare | undefined>(undefined);
export const usePublicMarkdownShare = () => useContext(PublicMarkdownContext);
