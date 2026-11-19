"use client";

import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { normalizeParameterValue, type ModelParameter } from "@/lib/model-params";

/** Draft until Apply: partial input never becomes a persisted run parameter. */
export function ModelNumberOption({ parameter, value, onChange }: {
  parameter: ModelParameter; value: string; onChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const id = useId();
  useEffect(() => setDraft(value), [value]);
  const shorthand = parameter.customNumber?.allowMagnitudeSuffix;
  const normalized = draft.trim() ? normalizeParameterValue(parameter, draft) : "";
  const invalid = normalized === undefined;
  function apply() {
    if (normalized === undefined || normalized === value) return;
    setDraft(normalized);
    onChange(normalized);
    if (parameter.customNumber?.description) toast.info(parameter.customNumber.description);
  }
  return <div className="min-w-0 space-y-2">
    <label htmlFor={id} className="text-xs font-medium md:text-sm">{parameter.displayName || parameter.id}</label>
    <div className="flex min-w-0 gap-2">
      <Input id={id} type="text" inputMode={shorthand ? "text" : "numeric"} value={draft}
        placeholder="Automatic" aria-invalid={invalid} aria-describedby={invalid || shorthand ? id + "-help" : undefined}
        className="h-9 min-w-0 flex-1" onChange={event => setDraft(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); apply(); } }} />
      <Button type="button" size="sm" className="h-9 shrink-0" disabled={invalid || normalized === value}
        onClick={apply}>Apply</Button>
    </div>
    {invalid || shorthand ? <p id={id + "-help"} role={invalid ? "alert" : undefined} className="text-xs text-muted-foreground">
      {invalid && "Enter a whole token count from " + parameter.customNumber?.min.toLocaleString("en-US") + " to " + parameter.customNumber?.max.toLocaleString("en-US") + "."}
      {shorthand && (invalid ? " For example, " : "Examples: ")}{shorthand && <><code>500k</code> or <code>1.05m</code>.</>}
    </p> : null}
  </div>;
}
