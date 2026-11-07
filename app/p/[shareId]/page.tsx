import { notFound } from "next/navigation";
import { getSharedProfile } from "@/lib/account-profile";
import { getAccountUsage } from "@/lib/account-usage";
import { ProfileAvatar } from "@/components/account/account-menu";
import { BannerHeader } from "@/components/banner-image";
import { TokenHeatmap } from "@/components/account/token-heatmap";
import { publicTokenActivity } from "@/lib/profile-token-activity";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export const metadata={title:"Profile · Metis",robots:{index:false,follow:false}};
export default async function SharedProfilePage({params}:{params:Promise<{shareId:string}>}) {
  const {shareId}=await params;
  const shared=getSharedProfile(shareId);if(!shared)notFound();
  const {profile,ownerId}=shared;
  const end=new Date().toISOString().slice(0,10),start=new Date(Date.parse(end)-364*86400000).toISOString().slice(0,10);
  // Only daily token totals cross the public boundary. Never serialize cost, model, owner or run data.
  const days=profile.shareActivity?publicTokenActivity(getAccountUsage(ownerId,start,end).days):null;
  return <main className="min-h-dvh bg-background px-5 py-10 text-foreground sm:px-8">
    <div className="mx-auto max-w-3xl">
      <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Metis</Link>
      <section className="mt-14">
        <BannerHeader value={profile.banner} alt="Profile banner" bannerClassName="aspect-[4/1] w-full rounded-xl" gapClassName="mt-6">
        <ProfileAvatar profile={profile} name={profile.displayName} className="size-24 text-3xl"/>
        <h1 className="mt-6 break-words text-3xl font-semibold tracking-tight">{profile.displayName}</h1>
        {profile.handle?<p className="mt-2 break-all text-sm text-muted-foreground">@{profile.handle}</p>:null}
        {profile.bio?<p className="mt-4 whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">{profile.bio}</p>:null}
        <div className="my-6 flex flex-wrap gap-4">{profile.links.map((link,index)=><a key={index} href={link.url} rel="noopener noreferrer" target="_blank" className="inline-flex min-h-11 items-center gap-2 text-sm hover:underline">{link.label}<ExternalLink className="size-3.5"/></a>)}</div>
        {days?<TokenHeatmap days={days}/>:null}
        </BannerHeader>
      </section>
    </div>
  </main>;
}
