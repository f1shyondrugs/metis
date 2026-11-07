"use client";

import { useRef, useState } from "react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { ArrowUp, ArrowDown, Check, GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { TASK_LIST_MAX_ITEMS, TASK_LIST_MAX_CHARS } from "@/lib/mcp-core/task-list.mjs";

type Row = { id: string; text: string };
type Props = {
  id: string; value: string; language?: string; disabled?: boolean;
  "aria-invalid"?: boolean; "aria-describedby"?: string;
  onChange: (value: string) => void;
};
function readDraft(value: string): string[] {
  try { const rows: unknown = JSON.parse(value || "[]"); return Array.isArray(rows) && rows.every(item => typeof item === "string") ? rows : []; }
  catch { return []; }
}
function TaskRow({ row, index, count, editing, disabled, onText, onMove, onDelete }: {
  row: Row; index: number; count: number; editing: boolean; disabled?: boolean;
  onText: (text: string) => void; onMove: (direction: number) => void; onDelete: () => void;
}) {
  const drag = useDraggable({ id: row.id, disabled: !editing || disabled });
  const drop = useDroppable({ id: row.id, disabled: !editing || disabled });
  const label = `Step ${index + 1}`;
  return <li ref={drop.setNodeRef} data-task-id={row.id}><div ref={drag.setNodeRef}
    className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-2 py-2"
    style={drag.transform ? { transform: `translate3d(${drag.transform.x}px,${drag.transform.y}px,0)`, opacity: 0.5, zIndex: 1, position: "relative" } : undefined}>
    <span className="pt-2 text-sm tabular-nums text-muted-foreground" aria-hidden="true">{index + 1}.</span>
    <div className="min-w-0">
      {editing ? <>
        <Textarea aria-label={label} disabled={disabled} autoFocus={!row.text} value={row.text} maxLength={TASK_LIST_MAX_CHARS}
          onChange={event => onText(event.target.value)} className="min-h-20 text-sm" />
        <div className="mt-1 flex items-center gap-1">
          <button type="button" {...drag.attributes} {...drag.listeners} disabled={disabled}
            aria-label={`Drag ${label}`}
            className="inline-flex size-10 touch-none items-center justify-center rounded-md text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">
            <GripVertical className="size-4" aria-hidden="true" />
          </button>
          <Button type="button" variant="ghost" size="icon" className="size-10" disabled={disabled || index === 0} aria-label={`Move ${label} up`} onClick={() => onMove(-1)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" className="size-10" disabled={disabled || index === count - 1} aria-label={`Move ${label} down`} onClick={() => onMove(1)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
          <Button type="button" variant="ghost" size="icon" className="ml-auto size-10 text-muted-foreground" disabled={disabled} aria-label={`Delete ${label}`} onClick={onDelete}><Trash2 className="size-4" aria-hidden="true" /></Button>
        </div>
      </> : <p className="whitespace-pre-wrap wrap-break-word py-2 text-sm leading-relaxed">{row.text}</p>}
    </div>
  </div></li>;
}
export function TaskListInput({ id, value, language: _language, disabled, onChange, ...aria }: Props) {
  const counter = useRef(0);
  const makeRows = (texts: string[]) => texts.map(text => ({ id: `${id}-task-${++counter.current}`, text }));
  const [state, setState] = useState(() => ({ value, rows: makeRows(readDraft(value)) }));
  const [editing, setEditing] = useState(false);
  // External draft restoration resets row identities; local edits and moves keep stable IDs.
  if (state.value !== value) setState({ value, rows: makeRows(readDraft(value)) });
  const rows = state.rows;
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor));
  function change(next: Row[]) {
    const encoded = JSON.stringify(next.map(row => row.text));
    setState({ value: encoded, rows: next });
    onChange(encoded);
  }
  function move(from: number, to: number) {
    if (disabled || from < 0 || to < 0 || to >= rows.length || from === to) return;
    const next = [...rows]; const [row] = next.splice(from, 1); next.splice(to, 0, row); change(next);
  }
  function dragEnd(event: DragEndEvent) {
    if (!event.over || disabled) return;
    move(rows.findIndex(row => row.id === event.active.id), rows.findIndex(row => row.id === event.over!.id));
  }
  const length = rows.map(row => row.text).join("\n").length;
  return <div id={id} role="group" aria-labelledby={id + "-label"} {...aria}>
    <div className="flex justify-end">
      <Button type="button" variant="ghost" size="sm" disabled={disabled} aria-expanded={editing} aria-controls={id + "-steps"}
        onClick={() => setEditing(current => !current)} className="gap-2 text-muted-foreground">
        {editing ? <Check className="size-4" aria-hidden="true" /> : <Pencil className="size-4" aria-hidden="true" />}
        {editing ? "Done" : "Edit"}
      </Button>
    </div>
    <DndContext id={id + "-sort"} sensors={sensors} collisionDetection={closestCenter} onDragEnd={dragEnd}>
      <ol id={id + "-steps"} className="list-none divide-y divide-border">
        {rows.map((row, index) => <TaskRow key={row.id} row={row} index={index} count={rows.length} editing={editing} disabled={disabled}
          onText={text => change(rows.map(item => item.id === row.id ? { ...item, text } : item))}
          onMove={direction => move(index, index + direction)} onDelete={() => change(rows.filter(item => item.id !== row.id))} />)}
      </ol>
    </DndContext>
    {!rows.length ? <p className="py-3 text-sm text-muted-foreground">No steps yet. Add a step below.</p> : null}
    {editing ? <div className="mt-3 space-y-2">
      <Button type="button" variant="outline" size="sm" className="w-full gap-2" disabled={disabled || rows.length >= TASK_LIST_MAX_ITEMS}
        onClick={() => change([...rows, ...makeRows([""])])}><Plus className="size-4" aria-hidden="true" />Add step</Button>
      <p className="text-xs tabular-nums text-muted-foreground">{rows.length}/{TASK_LIST_MAX_ITEMS} · {length}/{TASK_LIST_MAX_CHARS} characters</p>
    </div> : null}
  </div>;
}
