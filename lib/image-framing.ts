import type { CSSProperties } from "react";

export type ImageCrop = { x: number; y: number; width: number; height: number };
export type BannerStyle = "standard" | "fade";
export type ImageFraming = ({ mode: "fit" } | { mode: "crop"; area: ImageCrop }) & { bannerStyle?: "fade" };
const marker = "#metis-image=";
export const DEFAULT_IMAGE_CROP: ImageCrop = { x: 0, y: 0, width: 100, height: 100 };

export function validImageCrop(area: ImageCrop): boolean {
  return [area.x, area.y, area.width, area.height].every(Number.isFinite) &&
    area.x >= 0 && area.y >= 0 && area.width >= 0.01 && area.height >= 0.01 &&
    area.x + area.width <= 100.01 && area.y + area.height <= 100.01;
}

/** A bounded URL fragment stores display-only framing; the original image stays untouched. */
export function parseImageFraming(value: string): { source: string; framing: ImageFraming | null; valid: boolean } {
  const at = value.lastIndexOf(marker);
  if (at < 0) return { source: value, framing: null, valid: true };
  const source = value.slice(0, at), payload = value.slice(at + marker.length);
  const fade = payload.endsWith(";banner=fade");
  const data = fade ? payload.slice(0, -";banner=fade".length) : payload;
  const style = fade ? { bannerStyle: "fade" as const } : {};
  if (!source || source.includes(marker)) return { source, framing: null, valid: false };
  if (data === "fit") return { source, framing: { mode: "fit", ...style }, valid: true };
  const match = /^crop,([\d.]+),([\d.]+),([\d.]+),([\d.]+)$/.exec(data);
  if (match) {
    const [x, y, width, height] = match.slice(1).map(Number);
    const area = { x, y, width, height };
    if (validImageCrop(area)) return { source, framing: { mode: "crop", area, ...style }, valid: true };
  }
  return { source, framing: null, valid: false };
}

export function withImageFraming(value: string, framing: ImageFraming | null): string {
  const source = parseImageFraming(value).source;
  if (!framing) return source;
  const style = framing.bannerStyle === "fade" ? ";banner=fade" : "";
  if (framing.mode === "fit") return source + marker + "fit" + style;
  if (!validImageCrop(framing.area)) throw new Error("Choose a valid image crop.");
  const { x, y, width, height } = framing.area;
  return source + marker + "crop," + [x, y, width, height].map(n => Number(n.toFixed(4))).join(",") + style;
}

export function bannerStyle(value: string | null | undefined): BannerStyle {
  return value && parseImageFraming(value).framing?.bannerStyle === "fade" ? "fade" : "standard";
}

export function withBannerStyle(value: string, style: BannerStyle): string {
  const parsed = parseImageFraming(value);
  const framing = parsed.framing || { mode: "crop" as const, area: DEFAULT_IMAGE_CROP };
  const { bannerStyle: _style, ...base } = framing;
  return withImageFraming(parsed.source, style === "fade" ? { ...base, bannerStyle: "fade" } : base);
}

/** Alpha mask fades the actual image into any theme or custom page background. */
export function bannerFadeStyle(style: BannerStyle): CSSProperties | undefined {
  if (style !== "fade") return undefined;
  const mask = "linear-gradient(to bottom, #000 0%, transparent 100%)";
  return { maskImage: mask, WebkitMaskImage: mask };
}

export function imageFramingStyle(framing: ImageFraming | null, circle = false, aspect = 1): CSSProperties {
  if (framing?.mode === "fit") {
    // Inscribe the entire rectangle inside the circle, including its corners.
    const ratio = Number.isFinite(aspect) && aspect > 0 ? Math.min(aspect, 1 / aspect) : 1;
    const scale = circle ? 1 / Math.sqrt(1 + ratio * ratio) : 1;
    return { objectFit: "contain", objectPosition: "center", transform: `scale(${scale})`, transformOrigin: "center", borderRadius: 0 };
  }
  if (!framing) return { objectFit: "cover" };
  const { x, y, width, height } = framing.area;
  const anchor = (offset: number, size: number) => size >= 99.9999 ? 50 : Math.min(100, Math.max(0, 100 * offset / (100 - size)));
  const origin = `${anchor(x, width)}% ${anchor(y, height)}%`;
  const zoom = Math.min(100 / width, 100 / height);
  return { objectFit: "cover", objectPosition: origin, transform: `scale(${zoom})`, transformOrigin: origin, borderRadius: 0 };
}
