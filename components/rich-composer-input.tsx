"use client";

import {
  forwardRef,
  useLayoutEffect,
  useCallback,
  useRef,
  useReducer,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { shouldSyncComposerDom, stripComposerPlaceholderLeak } from "@/lib/composer-send";
import { cn } from "@/lib/utils";
import { composerIsComposing, composerMentionQuery, type ComposerMentionQuery } from "@/lib/composer-references";

const MAX_COMPOSER_HEIGHT = 180;
const MIN_COMPOSER_HEIGHT = 36;

type RichComposerInputProps = {
  value: string;
  mentionLabels?: string[];
  syncNonce?: number;
  /** Passive desktop voice must not acquire keyboard focus after sending. */
  focusOnClear?: boolean;
  onChange: (value: string, cursorPosition: number) => void;
  /** Caret-only updates must not mark the draft dirty or persist it. */
  onSelectionChange?: (value: string, start: number, end: number) => void;
  onMentionQueryChange?: (query: ComposerMentionQuery | null) => void;
  "aria-controls"?: string;
  "aria-expanded"?: boolean;
  "aria-activedescendant"?: string;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onPaste?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  onFocus?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  onBlur?: (event: FocusEvent<HTMLTextAreaElement>) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

export function composerPlainText(element: HTMLElement | null | undefined, placeholder?: string) {
  if (!element) return "";
  // Preserve literal placeholder text, NBSPs, markdown and line breaks in native inputs.
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) return element.value;
  const raw = (element.textContent || "").replace(/\u00a0/g, " ");
  return stripComposerPlaceholderLeak(raw.replace(/\u00a0/g, " "), placeholder);
}

function fitComposerHeight(element: HTMLTextAreaElement) {
  const scrollTop = element.scrollTop;
  element.style.height = "auto";
  const fullHeight = element.scrollHeight;
  element.style.height = Math.min(MAX_COMPOSER_HEIGHT, Math.max(MIN_COMPOSER_HEIGHT, fullHeight)) + "px";
  element.style.overflowY = fullHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
  element.scrollTop = scrollTop;
}

export const RichComposerInput = forwardRef<HTMLTextAreaElement, RichComposerInputProps>(
  function RichComposerInput(
    {
      value,
      mentionLabels = [],
      syncNonce,
      focusOnClear = true,
      onChange,
      onSelectionChange,
      onMentionQueryChange,
      "aria-controls": ariaControls,
      "aria-expanded": ariaExpanded,
      "aria-activedescendant": ariaActiveDescendant,
      onKeyDown,
      onPaste,
      onFocus,
      onBlur,
      placeholder,
      className,
      disabled,
      "aria-label": ariaLabel,
    },
    ref,
  ) {
    const editorRef = useRef<HTMLTextAreaElement>(null);
    const lastSyncNonceRef = useRef(syncNonce ?? 0);
    // A native textarea cannot leak its placeholder into its value.
    const liveValue = value;
    const initialValueRef = useRef(liveValue);
    const composingRef = useRef(false);
    const [compositionEpoch, finishComposition] = useReducer((epoch: number) => epoch + 1, 0);
    const reportSelection = (element: HTMLTextAreaElement) => {
      if (composingRef.current) return;
      const start = element.selectionStart;
      const end = element.selectionEnd;
      onSelectionChange?.(element.value, start, end);
      onMentionQueryChange?.(composerMentionQuery(element.value, start, end, mentionLabels));
    };
    const attachEditor = useCallback((node: HTMLTextAreaElement | null) => {
      editorRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
      if (node) fitComposerHeight(node);
    }, [ref]);

    useLayoutEffect(() => {
      const element = editorRef.current;
      if (!element || composingRef.current) return;
      const nonceChanged = syncNonce !== undefined && syncNonce !== lastSyncNonceRef.current;
      if (nonceChanged) lastSyncNonceRef.current = syncNonce;
      const focused = document.activeElement === element;
      if (!nonceChanged && focused) return;
      if (!shouldSyncComposerDom(element.value, liveValue, focused, nonceChanged)) return;
      element.value = liveValue;
      if (nonceChanged) {
        const cursor = liveValue.length;
        if (liveValue === "" && focusOnClear) element.focus();
        if (liveValue === "" || focused) element.setSelectionRange(cursor, cursor);
        element.scrollTop = element.scrollHeight;
      }
      fitComposerHeight(element);
    }, [liveValue, syncNonce, compositionEpoch, focusOnClear]);
    useLayoutEffect(() => {
      const element=editorRef.current;if(!element)return;
      let width=element.clientWidth;
      const observer=new ResizeObserver(()=>{
        if(element.clientWidth===width)return;
        width=element.clientWidth;fitComposerHeight(element);
      });
      observer.observe(element);return ()=>observer.disconnect();
    }, []);

    return (
      <textarea
        ref={attachEditor}
        defaultValue={initialValueRef.current}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
        aria-label={ariaLabel}
        role={ariaControls ? "combobox" : undefined}
        aria-autocomplete={ariaControls ? "list" : undefined}
        aria-controls={ariaControls}
        aria-expanded={ariaExpanded}
        aria-activedescendant={ariaExpanded ? ariaActiveDescendant : undefined}
        className={cn(
          "rich-composer-input block min-h-9 max-h-[180px] w-full flex-1 resize-none overflow-y-auto whitespace-pre-wrap rounded-none border-0 bg-transparent px-3 py-1.5 text-[15px] leading-6 shadow-none outline-none",
          "placeholder:select-none placeholder:text-muted-foreground",
          "focus-visible:ring-0",
          "disabled:pointer-events-none disabled:opacity-50",
          className,
        )}
        onChange={(event) => {
          const element = event.currentTarget;
          const next = element.value;
          fitComposerHeight(element);
          if (!composingRef.current) {
            onChange(next, element.selectionStart ?? next.length);
            reportSelection(element);
          }
        }}
        onSelect={(event) => reportSelection(event.currentTarget)}
        onCompositionStart={() => {
          composingRef.current = true;
          onMentionQueryChange?.(null);
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          const element = event.currentTarget;
          fitComposerHeight(element);
          onChange(element.value, element.selectionStart);
          reportSelection(element);
          finishComposition();
        }}
        onKeyDown={(event) => {
          // Picker handlers run before the parent's send guard; protect all IME keys here.
          if (composerIsComposing(event.nativeEvent, composingRef.current)) return;
          onKeyDown?.(event);
        }}
        onPaste={onPaste}
        onFocus={onFocus}
        onBlur={onBlur}
      />
    );
  },
);
