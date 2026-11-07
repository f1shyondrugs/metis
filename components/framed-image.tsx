"use client";

import { useState, type ImgHTMLAttributes } from "react";
import { imageFramingStyle, parseImageFraming } from "@/lib/image-framing";
import { cn } from "@/lib/utils";

export function FramedImage({ src, alt, circle = false, className, imageClassName, onLoad, ...props }: Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  src: string; circle?: boolean; imageClassName?: string;
}) {
  const { source, framing } = parseImageFraming(src);
  const [dimensions, setDimensions] = useState({ source: "", aspect: 1 });
  const aspect = dimensions.source === source ? dimensions.aspect : 1;
  return <span className={cn("relative block overflow-hidden bg-muted", circle && "rounded-full", className)}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img {...props} src={source} alt={alt} className={cn("absolute inset-0 size-full", imageClassName)}
      style={imageFramingStyle(framing, circle, aspect)} onLoad={event => {
        const image = event.currentTarget;
        setDimensions({ source, aspect: image.naturalWidth / image.naturalHeight });
        onLoad?.(event);
      }} />
  </span>;
}
