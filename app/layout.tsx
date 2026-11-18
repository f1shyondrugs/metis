import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { AppearanceProvider } from "@/components/appearance-provider";
import { PublicBaseUrlProvider } from "@/components/public-base-url";
import { createAppearanceBootstrapScript } from "@/lib/appearance-bootstrap";
import { config } from "@/lib/config";
import { getAuthenticatedUserId } from "@/lib/auth";
import { getAppearanceSettings } from "@/lib/appearance-settings";
import { createDefaultAppearanceState } from "@/lib/appearance-storage";
import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: config.appName,
  description: config.appDescription,
  icons: {
    icon: { url: "/favicon.svg", type: "image/svg+xml" },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const ownerId = await getAuthenticatedUserId();
  let appearance;
  try { appearance = ownerId ? getAppearanceSettings(ownerId) : null; } catch { /* Keep the app usable; the settings API reports the load error. */ }
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("dark font-sans", geist.variable, geistMono.variable)}
    >
      <head><script dangerouslySetInnerHTML={{ __html: createAppearanceBootstrapScript({ state: appearance?.state ?? createDefaultAppearanceState(), allowLocalStorage: false }) }} /></head>
      <body className="min-h-dvh bg-background text-foreground">
        <PublicBaseUrlProvider base={config.publicBaseUrl}>
        <AppearanceProvider mode="account" initialAccount={appearance}>
        <TooltipProvider delayDuration={200}>
          {children}
          <Toaster richColors />
        </TooltipProvider>
        </AppearanceProvider>
        </PublicBaseUrlProvider>
      </body>
    </html>
  );
}
