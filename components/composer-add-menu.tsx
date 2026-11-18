"use client";
import { useRef, useState } from "react";
import { AtSign, Paperclip, Plus, Slash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function ComposerAddMenu({ onFiles, onContext, onCommands }: { onFiles: () => void; onContext: () => void; onCommands?: () => void }) {
  const [open, setOpen] = useState(false);
  const lastPress = useRef<number | null>(null);
  function files() { lastPress.current = null; setOpen(false); onFiles(); }
  return <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
    <DropdownMenuTrigger asChild>
      <Button type="button" variant="ghost" size="icon" aria-label="Add" title="Add · double-tap for files"
        className="size-11 shrink-0 self-end rounded-full sm:size-9"
        onPointerDown={event => {
          if (event.button !== 0 || !event.isPrimary) return;
          const now = performance.now(), previous = lastPress.current;
          lastPress.current = now;
          if (previous !== null && now - previous < 400) {
            event.preventDefault(); event.stopPropagation(); files();
          }
        }}>
        <Plus className="size-4" aria-hidden="true"/>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" side="top" collisionPadding={8} className="w-[min(15rem,calc(100vw-1rem))] rounded-xl">
      <DropdownMenuItem onSelect={files}><Paperclip className="size-4"/><span>Files</span></DropdownMenuItem>
      <DropdownMenuItem onSelect={() => { lastPress.current = null; setOpen(false); onContext(); }}><AtSign className="size-4"/><span>Context</span></DropdownMenuItem>
      {onCommands ? <DropdownMenuItem onSelect={() => { lastPress.current = null; setOpen(false); onCommands(); }}><Slash className="size-4"/><span>Commands</span></DropdownMenuItem> : null}
    </DropdownMenuContent>
  </DropdownMenu>;
}
