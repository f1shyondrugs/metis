"use client";
import { useEffect, useState } from "react";
import { ChartNoAxesCombined, ChevronsUpDown, Settings, UserRound, Puzzle, Bell, LogOut, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useDesktopAvailable } from "@/lib/desktop-bridge";
import { useDesktopState } from "@/lib/use-desktop-state";
import { DesktopFileDrop } from "@/components/desktop-file-drop";
import { DesktopAppSettingsDialog } from "@/components/desktop-app-settings-dialog";
import type { AccountIdentity, AccountProfile } from "@/lib/account-types";
export function useAccountProfile(enabled: boolean) {
  const [profile,setProfile]=useState<AccountProfile|null>(null);
  const [error,setError]=useState(false),[revision,setRevision]=useState(0);
  useEffect(()=>{
    if(!enabled) { setProfile(null);return; }
    const controller=new AbortController();setError(false);
    void fetch("/api/profile",{cache:"no-store",signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error("Could not load profile");
      setProfile((await response.json()).profile);
    }).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return ()=>controller.abort();
  },[enabled,revision]);
  return {profile,setProfile,error,retry:()=>setRevision(value=>value+1)};
}
export function ProfileAvatar({profile,name,className}: {profile:AccountIdentity|null;name:string;className?:string}) {
  return <Avatar className={className}>
    {profile?.avatar ? <AvatarImage src={profile.avatar} alt="" /> : null}
    <AvatarFallback className="bg-muted text-foreground">{(profile?.displayName || name).slice(0,2).toUpperCase()}</AvatarFallback>
  </Avatar>;
}
export function AccountMenu({profile,username,updateAvailable,onSettings,onProfile,onUsage,onAgentHub,unreadCount=0,onNotifications,onLogout}: {
  profile:AccountProfile|null;username:string;updateAvailable:boolean;
  onSettings:()=>void;onProfile:()=>void;onUsage:()=>void;onLogout:()=>void;onAgentHub?:()=>void;unreadCount?:number;onNotifications?:()=>void;
}) {
  const desktop=useDesktopAvailable();
  const {state}=useDesktopState();
  const [appSettingsOpen,setAppSettingsOpen]=useState(false);
  const appUpdateAvailable=desktop&&state?.appUpdate?.available===true;
  return <><DesktopFileDrop /><DropdownMenu>
    <DropdownMenuTrigger asChild>
      <Button variant="ghost" className="h-12 w-full justify-start gap-2.5 px-2.5" aria-label="Open account menu">
        <span className="relative shrink-0"><ProfileAvatar profile={profile} name={username} className="size-8" />
          {updateAvailable||appUpdateAvailable ? <span className="absolute -right-0.5 -bottom-0.5 size-2 rounded-full bg-primary ring-2 ring-background" aria-label={appUpdateAvailable?"App update available":"Update available"} /> : null}
          {unreadCount > 0 ? <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-destructive ring-2 ring-background" aria-label={`${unreadCount} unread notifications`} /> : null}
        </span>
        <span className="min-w-0 flex-1 truncate text-left text-sm">{profile?.displayName || username}</span>
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent side="top" align="start" sideOffset={8} className="min-w-52" onCloseAutoFocus={event=>{if(appSettingsOpen)event.preventDefault();}}>
      <div className="truncate px-2 py-2 text-xs text-muted-foreground">{username}</div>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onProfile}><UserRound /> Profile</DropdownMenuItem>
      {onNotifications ? <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onNotifications}><Bell /> Notifications{unreadCount > 0 ? <span className="ml-auto size-2 rounded-full bg-destructive" aria-label="Unread notifications" /> : null}</DropdownMenuItem> : null}
      {onAgentHub ? <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onAgentHub}><Puzzle /> Agent Hub</DropdownMenuItem> : null}
      <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onSettings}><Settings /> Settings{updateAvailable ? <span className="ml-auto size-1.5 rounded-full bg-primary" /> : null}</DropdownMenuItem>
      {desktop?<DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={()=>setAppSettingsOpen(true)}><Monitor /> App settings{appUpdateAvailable?<span className="ml-auto size-2 rounded-full bg-primary" aria-label="App update available"/>:null}</DropdownMenuItem>:null}
      <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onUsage}><ChartNoAxesCombined /> Usage</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem className="min-h-11 gap-2 px-2" onSelect={onLogout}><LogOut /> Logout</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>{desktop?<DesktopAppSettingsDialog open={appSettingsOpen} onOpenChange={setAppSettingsOpen}/>:null}</>;
}
