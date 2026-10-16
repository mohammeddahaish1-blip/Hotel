import type { Metadata, Viewport } from "next";
import { Amiri, IBM_Plex_Sans_Arabic } from "next/font/google";
import { getDict } from "@/lib/i18n/server";
import "./globals.css";

const plex = IBM_Plex_Sans_Arabic({
  variable: "--font-arabic",
  subsets: ["arabic", "latin"],
  weight: ["400", "500", "600", "700"],
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
  return (
    <html lang={lang} dir={lang === "ar" ? "rtl" : "ltr"} className={`${plex.variable} ${amiri.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
