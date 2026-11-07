"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Pin } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ProviderLogo } from "@/components/provider-logo";
import type { ModelInfo } from "@/components/settings-panel";
import { cn } from "@/lib/utils";
import { modelForSelection } from "@/lib/model-selection";
import { modelAccountGroups, modelAccountKey, modelAccountLabel, modelMatchesAccount } from "@/lib/model-account-groups";

export function ModelPicker({
  models,
  value,
  onValueChange,
  favoriteModelKeys,
  onToggleFavorite,
  disabled = false,
  className,
  ariaLabel = "Default model",
  placeholder = "Select a model",
  noneLabel,
  allowPinning = true,
}: {
  models: ModelInfo[];
  value: string;
  onValueChange: (value: string) => void;
  favoriteModelKeys: string[];
  onToggleFavorite: (value: string) => void;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  placeholder?: string;
  noneLabel?: string;
  allowPinning?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const searchRef = useRef<HTMLInputElement>(null);
  const selected = modelForSelection(models, value);
  const normalized = String(search ?? "").trim().toLowerCase();
  const providers = modelAccountGroups(models);
  const selectedAccountLabel = selected ? modelAccountLabel(selected, providers) : undefined;
  const providerQueryMatch = normalized.match(/^([a-z0-9_-]+):(.*)$/);
  const providerQuery = providerQueryMatch && providers.some((provider) => provider.providerId === providerQueryMatch[1])
    ? providerQueryMatch[1]
    : null;
  const effectiveProvider = providerQuery || providerFilter;
  const term = providerQuery ? providerQueryMatch?.[2].trim() || "" : normalized;
  const matching = models.filter((model) =>
    modelMatchesAccount(model, effectiveProvider) &&
    String(`${model.displayName ?? ""} ${model.id ?? ""} ${model.description ?? ""} ${model.providerName ?? ""} ${model.connectionLabel ?? ""}`).toLowerCase().includes(term),
  );
  const favorites = effectiveProvider === "all"
    ? matching.filter((model) => favoriteModelKeys.includes(model.id))
    : [];
  const favoriteIds = new Set(favorites.map((model) => model.id));
  const groups = new Map<string, ModelInfo[]>();
  for (const model of matching.filter((entry) => !favoriteIds.has(entry.id))) {
    const key = modelAccountKey(model);
    groups.set(key, [...(groups.get(key) || []), model]);
  }

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => searchRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  function option(model: ModelInfo) {
    const providerId = model.providerId || "cursor";
    const favorite = favoriteModelKeys.includes(model.id);
    return (
      <DropdownMenuItem
        key={model.id}
        onClick={() => {
          onValueChange(model.id);
          setSearch("");
          setOpen(false);
        }}
        className="gap-2"
      >
        <Check className={cn("size-3.5 shrink-0", model.id === selected?.id ? "opacity-100" : "opacity-0")} />
        <ProviderLogo providerId={providerId} />
        <span className="min-w-0 flex-1 truncate">{model.displayName}{model.connectionLabel ? <span className="ml-1 text-xs text-muted-foreground">· {model.connectionLabel}</span> : null}</span>
        {allowPinning && <button
          type="button"
          className="rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label={favorite ? `Unpin ${model.displayName}` : `Pin ${model.displayName}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleFavorite(model.id);
          }}
        >
          <Pin className={cn("size-3", favorite ? "fill-current text-primary" : "")} />
        </button>}
      </DropdownMenuItem>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || models.length === 0}
          aria-label={ariaLabel}
          className={cn("h-10 w-full justify-between gap-2 text-left font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2 truncate">
            <ProviderLogo providerId={selected?.providerId} />
            <span className="truncate">{selected?.displayName || placeholder}</span>
            {selectedAccountLabel ? (
              <span className="truncate text-xs text-muted-foreground">· {selectedAccountLabel}</span>
            ) : null}
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[min(28rem,calc(100vw-2rem))] p-1.5">
        <Input
          ref={searchRef}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search or provider:model…"
          aria-label="Search models"
          className="h-9 text-xs"
          onKeyDown={(event) => event.stopPropagation()}
        />
        <div className="mt-1 flex gap-1 overflow-x-auto border-b border-border/60 pb-1">
          {[{ value: "all", providerId: "", label: "All" }, ...providers].map((provider) => (
            <button
              key={provider.value}
              type="button"
              aria-pressed={effectiveProvider === provider.value}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px]",
                effectiveProvider === provider.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              onClick={() => {
                setProviderFilter(provider.value);
                setSearch("");
              }}
            >
              {provider.value === "all" ? null : <ProviderLogo providerId={provider.providerId} className="size-3" />}
              {provider.label}
            </button>
          ))}
        </div>
        <div className="max-h-80 overflow-y-auto">
          {noneLabel ? (
            <DropdownMenuItem
              onClick={() => {
                onValueChange("");
                setSearch("");
                setOpen(false);
              }}
              className="gap-2"
            >
              <Check className={cn("size-3.5 shrink-0", value ? "opacity-0" : "opacity-100")} />
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{noneLabel}</span>
            </DropdownMenuItem>
          ) : null}
          {favorites.length ? (
            <div>
              <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <Pin className="size-3 fill-current text-primary" aria-hidden="true" />
                Pinned
              </p>
              {favorites.map(option)}
            </div>
          ) : null}
          {[...groups.entries()].map(([accountKey, providerModels]) => (
            <div key={accountKey}>
              <p className="flex items-center gap-1.5 px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <ProviderLogo providerId={providers.find((provider) => provider.value === accountKey)?.providerId} className="size-3" />
                {providers.find((provider) => provider.value === accountKey)?.label || accountKey}
              </p>
              {providerModels.map(option)}
            </div>
          ))}
          {!matching.length ? <p className="px-2.5 py-3 text-xs text-muted-foreground">No models found.</p> : null}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
