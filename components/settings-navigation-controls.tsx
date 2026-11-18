"use client";

import type { ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ProviderLogo } from "@/components/provider-logo";
import { cn } from "@/lib/utils";

type CustomSelectOption = {
  value: string;
  label: string;
  providerLogo?: string;
};

export function CustomSelect({
  value,
  options,
  onValueChange,
  ariaLabel,
  disabled = false,
  className,
}: {
  value: string;
  options: CustomSelectOption[];
  onValueChange: (value: string) => void;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const selected = options.find((option) => option.value === value) || options[0];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled || !selected}
          aria-label={ariaLabel}
          className={cn("h-9 min-w-0 justify-between gap-2 text-left font-normal", className)}
        >
          <span className="flex min-w-0 items-center gap-2">
            {selected?.providerLogo ? (
              <ProviderLogo providerId={selected.providerLogo} className="size-4 shrink-0" />
            ) : null}
            <span className="min-w-0 truncate">{selected?.label || "Select…"}</span>
          </span>
          <ChevronDown className="size-3.5 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-96 min-w-[14rem] overflow-y-auto">
        {options.map((option) => (
          <DropdownMenuItem
            key={option.value}
            onClick={() => onValueChange(option.value)}
            className="gap-2"
          >
            <Check className={cn("size-3.5 shrink-0", option.value === value ? "opacity-100" : "opacity-0")} />
            {option.providerLogo ? (
              <ProviderLogo providerId={option.providerLogo} className="size-4 shrink-0" />
            ) : null}
            <span className="truncate">{option.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SettingsTile({
  id,
  title,
  meta,
  icon: Icon,
  onOpen,
}: {
  id: string;
  title: string;
  meta: ReactNode;
  icon: LucideIcon;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      id={id}
      data-settings-tile={id}
      onClick={onOpen}
      className={cn(
        "flex min-h-16 w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors",
        "text-foreground hover:bg-muted/50",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{meta}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </button>
  );
}
