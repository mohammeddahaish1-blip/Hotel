import "server-only";
import { headers } from "next/headers";
import QRCode from "qrcode";

/** Public link of a property's guest form, on whatever domain the app is served from. */
export async function feedbackUrl(token: string) {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "nuzul-hotel.vercel.app";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}/f/${token}`;
}

export async function qrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", errorCorrectionLevel: "M", margin: 1, color: { dark: "#0d3b35", light: "#ffffff" } });
}

export async function qrPng(url: string) {
  return QRCode.toDataURL(url, { errorCorrectionLevel: "M", margin: 2, width: 800, color: { dark: "#0d3b35", light: "#ffffff" } });
}
