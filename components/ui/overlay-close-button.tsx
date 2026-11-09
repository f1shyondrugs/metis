"use client";
import type {ComponentProps} from "react";
import {X} from "lucide-react";
import {Button} from "@/components/ui/button";
import {cn} from "@/lib/utils";

/** One dismissal target for modal, sheet and shared-preview overlays. */
export function OverlayCloseButton({className,"aria-label":label="Close",...props}:ComponentProps<typeof Button>){
  return <Button type="button" variant="ghost" size="icon-action" className={cn("shrink-0",className)} {...props} aria-label={label}><X className="size-4" aria-hidden="true"/></Button>;
}
