import { productName } from "@/lib/product-name";

export const clientConfig = {
  appName: productName(process.env.NEXT_PUBLIC_APP_NAME),
  username: process.env.NEXT_PUBLIC_CHAT_USERNAME?.trim() || "",
  defaultCwd: process.env.NEXT_PUBLIC_AGENT_CWD?.trim() || "workspace",
  storagePrefix: process.env.NEXT_PUBLIC_STORAGE_PREFIX?.trim() || "metis-ai",
} as const;
