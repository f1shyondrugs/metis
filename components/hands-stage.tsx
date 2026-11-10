"use client";

import type { ComponentProps, ReactNode } from "react";
import { MetisMark } from "@/components/metis-mark";
import { cn } from "@/lib/utils";

// Keep the existing import stable for setup, maintenance and shared public pages.
export function HandsStage({
  children,
  contentClassName,
  ...props
}: {
  children: ReactNode;
  contentClassName?: string;
} & ComponentProps<"main">) {
  return (
    <main {...props} className={cn("relative flex min-h-dvh items-center justify-center overflow-hidden bg-background px-6 py-12 text-foreground", props.className)}>
      <div className="relative z-10 w-full max-w-xl">
        <MetisMark className="mx-auto mb-8 size-16 text-foreground" role="img" aria-label="Metis" />
        <section className={contentClassName}>{children}</section>
      </div>
    </main>
  );
}
