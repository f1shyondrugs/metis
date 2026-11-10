"use client";

import { createContext, useCallback, useContext, useRef, type ComponentProps } from "react";
import { VoiceInput } from "@/components/voice-input";
import { StickyActions } from "@/components/ui/sticky-actions";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { dictationAllowed, insertFieldTranscript } from "@/lib/field-dictation";
import { cn } from "@/lib/utils";

type Settings = Pick<ComponentProps<typeof VoiceInput>, "chatId" | "enabled" | "provider" | "modelId" | "realtime" | "endpoint" | "connectionId" | "maxDurationSeconds" | "onOpenSettings">;
export const FieldDictationContext = createContext<Settings | null>(null);

export function FieldDictationButton({ onTranscript, onStart, disabled = false }: {
  onTranscript: ComponentProps<typeof VoiceInput>["onTranscript"]; onStart?: () => void; disabled?: boolean;
}) {
  const settings = useContext(FieldDictationContext);
  if (!settings?.enabled || disabled) return null;
  return <VoiceInput {...settings} variant="field" onTranscript={onTranscript} onStart={onStart} />;
}

type Common = { value: string; onValueChange: (value: string) => void; dictationLabel?: string };
type InputProps = Omit<ComponentProps<typeof Input>, "value" | "onChange"> & Common;
type TextareaProps = Omit<ComponentProps<typeof Textarea>, "value" | "onChange"> & Common;

function Field({ multiline, value, onValueChange, dictationLabel, ...props }: (InputProps | TextareaProps) & { multiline: boolean }) {
  const settings = useContext(FieldDictationContext);
  const control = useRef<HTMLInputElement & HTMLTextAreaElement>(null);
  const live = useRef({ value, revision: 0, disabled: props.disabled || props.readOnly });
  if (live.current.value !== value) live.current = { ...live.current, value, revision: live.current.revision + 1 };
  live.current.disabled = props.disabled || props.readOnly;
  const applyRef = useRef(onValueChange);
  applyRef.current = onValueChange;
  const capture = useRef<{ value: string; revision: number; start: number; end: number } | null>(null);
  const start = useCallback(() => {
    capture.current = { ...live.current, start: control.current?.selectionStart ?? live.current.value.length, end: control.current?.selectionEnd ?? live.current.value.length };
  }, []);
  const change = (next: string) => {
    live.current = { ...live.current, value: next, revision: live.current.revision + 1 };
    applyRef.current(next);
  };
  const maxLengthRef = useRef(props.maxLength ?? 100_000);
  maxLengthRef.current = props.maxLength ?? 100_000;
  const transcript = useCallback((text: string) => {
    const before = capture.current;
    if (!before || live.current.disabled || live.current.revision !== before.revision || live.current.value !== before.value) return;
    const write = (spoken: string) => {
      const next = insertFieldTranscript(before.value, spoken, before.start, before.end, maxLengthRef.current);
      live.current = { ...live.current, value: next, revision: live.current.revision + 1 };
      applyRef.current(next);
    };
    write(text);
    const inserted = { ...live.current };
    return (finalText: string) => {
      if (!finalText.trim() || live.current.disabled || live.current.revision !== inserted.revision || live.current.value !== inserted.value) return;
      write(finalText);
    };
  }, []);
  const type = multiline ? "textarea" : ("type" in props ? props.type : undefined) || "text";
  const eligible = settings?.enabled && !props.disabled && !props.readOnly && dictationAllowed(type, [dictationLabel, props.name, props.id, props["aria-label"], props.placeholder].filter(Boolean).join(" "), props.autoComplete);
  const Element = multiline ? Textarea : Input;
  return <div className="relative grid min-w-0 w-full">
    <Element {...props as ComponentProps<typeof Input> & ComponentProps<typeof Textarea>} ref={control} value={value}
      onChange={event => change(event.target.value)} className={cn(props.className, "[grid-area:1/1]", eligible && "pr-14", eligible && (multiline ? "leading-6" : "min-h-11"))} />
    {eligible ? <StickyActions style={multiline ? undefined : { alignSelf: "center" }} className={cn("mr-0.5", multiline && "-mt-px sm:mt-[3px] pointer-coarse:-mt-px")}>
      <FieldDictationButton onStart={start} onTranscript={transcript} />
    </StickyActions> : null}
  </div>;
}
export function DictationInput(props: InputProps) {
  const settings = useContext(FieldDictationContext);
  return <Field {...props} key={settings?.chatId} multiline={false} />;
}
export function DictationTextarea(props: TextareaProps) {
  const settings = useContext(FieldDictationContext);
  return <Field {...props} key={settings?.chatId} multiline />;
}
