export async function uploadProfileBannerFile(file: File, signal: AbortSignal): Promise<string> {
  const response = await fetch("/api/profile/banner", {method:"PUT", headers:{"Content-Type":file.type}, body:file, signal});
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Could not upload banner. Try again.");
  if (typeof data.banner !== "string" || !/^\/api\/profile\/banner\/[a-f0-9]{48}$/.test(data.banner))
    throw new Error("The banner upload returned an invalid image. Try again.");
  return data.banner;
}
