"use client";
import type { ReactNode } from "react";
import { ArrowLeft, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ProfilePanel } from "@/components/account/profile-panel";
import { UsageDashboard } from "@/components/account/usage-dashboard";
import { NotificationsPanel } from "@/components/account/notifications-panel";
import type { AccountProfile } from "@/lib/account-types";

export type AccountView = "profile" | "agent-hub" | "settings" | "usage" | "notifications";
export function AccountPanel({view,onClose,onOpenNav,profile,onProfileChange,profileError,onRetry,children,onOpenProject,onOpenChat,onNotificationsChanged}: {
  onOpenProject?:(id:string)=>void;onOpenChat?:(id:string)=>void;onNotificationsChanged?:()=>void;
  view:AccountView;onClose:()=>void;onOpenNav:()=>void;
  profile:AccountProfile|null;onProfileChange:(profile:AccountProfile)=>void;profileError:boolean;onRetry:()=>void;children?:ReactNode;
}) {
  const managementPage = view === "agent-hub" || view === "settings";
  return <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/55 px-3 sm:px-5">
      <Button variant="ghost" size="icon" className="size-11 md:hidden" onClick={onOpenNav} aria-label="Open sidebar"><Menu className="size-4"/></Button>
      <Button variant="ghost" className="h-11 gap-2 px-2 text-muted-foreground" onClick={onClose} aria-label="Back to chat"><ArrowLeft className="size-4"/><span>Back to chat</span></Button>
    </header>
    {managementPage ? <main data-onboarding-target={view==="agent-hub"?"agents":"settings"} aria-label={view === "agent-hub" ? "Agent Hub" : "Settings"} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">{children}</main> : <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-5 py-8 sm:px-8 sm:py-10 lg:px-12">
        {view==="notifications"?<NotificationsPanel onOpenProject={onOpenProject} onOpenChat={onOpenChat} onNotificationsChanged={onNotificationsChanged}/>:view==="usage"?<UsageDashboard/>:profile?<ProfilePanel profile={profile} onChange={onProfileChange}/>:<div role="status" className="text-sm text-muted-foreground">{profileError?<><p>Could not load your profile.</p><Button variant="outline" className="mt-3" onClick={onRetry}>Try again</Button></>:"Loading profile…"}</div>}
      </div>
    </main>}
  </div>;
}
