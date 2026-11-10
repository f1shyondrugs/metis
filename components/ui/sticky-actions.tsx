import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A grid overlay (or flow toolbar) bounded by its component and actual scrollport. */
export function StickyActions({ edge = "top", className, ...props }: HTMLAttributes<HTMLDivElement> & { edge?: "top" | "bottom" }) {
  return <div {...props} data-contained-actions={edge} className={cn("contained-sticky-actions", className)} />;
}
