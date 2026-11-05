"use client";
import { MoreHorizontal } from "lucide-react";
import { ProviderLogo } from "@/components/provider-logo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { AccountUsage } from "@/lib/account-types";

export function UsageProviderFilter({providers,excluded,onChange,disabled}: {
  providers:NonNullable<AccountUsage["providers"]>;excluded:string[];onChange:(values:string[])=>void;disabled?:boolean;
}) {
  const hidden=providers.filter(provider=>excluded.includes(provider.id)).length;
  return <DropdownMenu modal={false}>
    <DropdownMenuTrigger asChild>
      <Button variant="outline" className="h-11 gap-2 px-3" aria-label="Filter usage providers" disabled={disabled}>
        <MoreHorizontal className="size-4" aria-hidden="true"/>
        <span className="text-sm">Providers{hidden ? " · "+(providers.length-hidden)+"/"+providers.length:""}</span>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className="w-64 max-w-[calc(100vw-2rem)]">
      <DropdownMenuLabel className="px-2 py-2 text-xs text-muted-foreground">Include providers</DropdownMenuLabel>
      <DropdownMenuSeparator/>
      {providers.length ? providers.map(provider=><DropdownMenuCheckboxItem key={provider.id} checked={!excluded.includes(provider.id)} aria-label={"Include "+provider.name} className="min-h-11 gap-2 px-2 pr-8" onSelect={event=>event.preventDefault()} onCheckedChange={checked=>onChange(checked ? excluded.filter(id=>id!==provider.id):[...excluded,provider.id])}>
        <span aria-hidden="true"><ProviderLogo providerId={provider.id} className="size-4"/></span>
        <span className="min-w-0 flex-1 truncate" title={provider.name}>{provider.name}</span>
        <span className="text-xs tabular-nums text-muted-foreground">{provider.requests.toLocaleString("en")}</span>
      </DropdownMenuCheckboxItem>):<p className="px-2 py-3 text-xs text-muted-foreground">No providers recorded in this period.</p>}
      <DropdownMenuSeparator/>
      <DropdownMenuItem className="min-h-11 px-2" onSelect={()=>onChange([])} disabled={!excluded.length}>Show all providers</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>;
}
