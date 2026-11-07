"use client";

import { useEffect, useRef } from "react";

export function VoiceTranscriptPreview({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() => { element.scrollTop = element.scrollHeight; });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} role="status" aria-label="Live transcript" aria-live="polite" aria-atomic={false}
      className="max-h-40 min-h-9 overflow-y-auto whitespace-pre-wrap break-words px-3 py-1.5 text-[15px] leading-relaxed text-foreground sm:text-sm">
      {text}
    </div>
  );
}
