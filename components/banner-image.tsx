import type { ReactNode } from "react";
import { FramedImage } from "@/components/framed-image";
import { bannerFadeStyle, bannerStyle } from "@/lib/image-framing";
import { cn } from "@/lib/utils";

export function BannerImage({ src, alt, className, referrerPolicy }: {
  src: string; alt: string; className?: string; referrerPolicy?: "no-referrer";
}) {
  const style = bannerStyle(src);
  return <div className="w-full" data-banner-style={style} style={bannerFadeStyle(style)}>
    <FramedImage src={src} alt={alt} referrerPolicy={referrerPolicy}
      className={cn(className, style === "fade" && "bg-transparent")}/>
  </div>;
}

export function BannerHeader({ value, alt, bannerClassName, contentClassName, children, referrerPolicy, gapClassName = "mt-7" }: {
  value?: string | null; alt: string; bannerClassName: string; contentClassName?: string;
  children: ReactNode; referrerPolicy?: "no-referrer"; gapClassName?: string;
}) {
  const fade = bannerStyle(value) === "fade";
  return <div className="relative isolate min-w-0" data-banner-header={fade ? "fade" : "standard"}>
    {value && <BannerImage src={value} alt={alt} className={bannerClassName} referrerPolicy={referrerPolicy}/>}
    <div className={cn(value && (fade ? "relative -mt-14 sm:-mt-20" : gapClassName), contentClassName)}>{children}</div>
  </div>;
}
