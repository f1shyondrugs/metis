"use client";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { AccountIdentity } from "@/lib/account-types";

export function ProfileAvatar({profile,name,className}: {profile:AccountIdentity|null;name:string;className?:string}) {
  return <Avatar className={className}>
    {profile?.avatar ? <AvatarImage src={profile.avatar} alt="" /> : null}
    <AvatarFallback className="bg-muted text-foreground">{(profile?.displayName || name).slice(0,2).toUpperCase()}</AvatarFallback>
  </Avatar>;
}
