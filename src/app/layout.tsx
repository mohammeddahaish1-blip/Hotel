import type { Metadata, Viewport } from "next";
import { Amiri, IBM_Plex_Sans_Arabic, Noto_Sans_Bengali } from "next/font/google";
import { cookies } from "next/headers";
import { getDict } from "@/lib/i18n/server";
import { isRtl } from "@/lib/i18n/dict";
import "./globals.css";

const plex = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
});

// Bengali letters for staff who use the interface in Bengali (Latin and Arabic come from the font above)
const bengali = Noto_Sans_Bengali({
  variable: "--font-bengali",
  subsets: ["bengali"],
  weight: ["400", "600", "700"],
  preload: false,
});

// Classic Naskh for the «نُزُل» wordmark
const amiri = Amiri({
  variable: "--font-brand",
  subsets: ["arabic", "latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "نُزُل — Nuzul PMS",
  description: "نظام تشغيل عربي للفنادق والشقق الفندقية في عُمان والخليج",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "نُزُل", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#0d6b5f",
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { lang } = await getDict();
  // the user's own choice of light or dark; without one the page follows the device
  const saved = (await cookies()).get("theme")?.value;
  const theme = saved === "dark" || saved === "light" ? saved : undefined;
  return (
    <html lang={lang} dir={isRtl(lang) ? "rtl" : "ltr"} data-theme={theme} className={`${plex.variable} ${bengali.variable} ${amiri.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
