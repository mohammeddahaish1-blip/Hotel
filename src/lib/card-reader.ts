"use client";

import { extractMrz, mrzToGuest, type ScannedGuest } from "./mrz";

/**
 * ID card / passport readers at the front desk. Two kinds of device are supported:
 *  1. "Keyboard" readers (most MRZ/OCR passport & ID scanners): they type the MRZ lines
 *     into whatever field has focus, so the page just listens to a text box.
 *  2. Smart-card readers (chip ID cards): the browser cannot talk to them directly, so a
 *     small helper runs on the reception PC (tools/card-bridge) and answers on localhost.
 */
export const BRIDGE_URL = "http://127.0.0.1:47290";

export type CardRead = ScannedGuest & { full_name_ar?: string; image?: File };

const DOC_TYPES = new Set(["oman_id", "gcc_id", "passport", "resident_card", "other"]);
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/** Readers that send all MRZ characters without line breaks: cut into TD1/TD2/TD3 lines. */
function splitMrz(text: string): string {
  const flat = text.replace(/\s/g, "").toUpperCase();
  if (text.includes("\n") || !/^[A-Z0-9<]+$/.test(flat)) return text;
  if (flat.length === 90) return flat.match(/.{30}/g)!.join("\n");
  if (flat.length === 72) return flat.match(/.{36}/g)!.join("\n");
  if (flat.length === 88) return flat.match(/.{44}/g)!.join("\n");
  return text;
}

/** Text typed by a keyboard reader (or pasted): MRZ lines, or the bridge's JSON. */
export function parseReaderText(text: string): CardRead | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      return fromBridge(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }
  const lines = extractMrz(splitMrz(trimmed));
  if (!lines) return null;
  const g = mrzToGuest(lines);
  return g.doc_number ? g : null;
}

/** Normalise the bridge's answer: { mrz?, fields?, image? } (see tools/card-bridge/README.md). */
function fromBridge(body: unknown): CardRead | null {
  if (!body || typeof body !== "object") return null;
  const b = body as { mrz?: string | string[]; fields?: Record<string, unknown>; image?: string };
  let out: CardRead = { valid: false };
  if (b.mrz) {
    const lines = extractMrz(splitMrz(Array.isArray(b.mrz) ? b.mrz.join("\n") : b.mrz));
    if (lines) out = mrzToGuest(lines);
  }
  const f = b.fields ?? {};
  const docType = str(f.doc_type, 20);
  out = {
    ...out,
    full_name: str(f.full_name, 120) ?? out.full_name,
    full_name_ar: str(f.full_name_ar, 120),
    nationality: str(f.nationality, 3)?.toUpperCase() ?? out.nationality,
    doc_type: docType && DOC_TYPES.has(docType) ? (docType as CardRead["doc_type"]) : out.doc_type,
    doc_number: str(f.doc_number, 30) ?? out.doc_number,
    doc_expiry: isDate(f.doc_expiry) ? f.doc_expiry : out.doc_expiry,
    date_of_birth: isDate(f.date_of_birth) ? f.date_of_birth : out.date_of_birth,
    gender: f.gender === "M" || f.gender === "F" ? f.gender : out.gender,
    valid: out.valid || Boolean(b.fields),
  };
  if (typeof b.image === "string" && b.image.startsWith("data:image/")) {
    const [head, data] = b.image.split(",", 2);
    const type = head.slice(5, head.indexOf(";"));
    const bytes = Uint8Array.from(atob(data ?? ""), (c) => c.charCodeAt(0));
    if (bytes.length > 0 && bytes.length < 4_000_000) out.image = new File([bytes], `card.${type === "image/png" ? "png" : "jpg"}`, { type });
  }
  return out.doc_number || out.full_name ? out : null;
}

/** Is the reader helper running on this PC? Returns the device name, or null. */
export async function bridgeStatus(): Promise<string | null> {
  try {
    const res = await fetch(`${BRIDGE_URL}/status`, { signal: AbortSignal.timeout(1200), cache: "no-store" });
    if (!res.ok) return null;
    const body = (await res.json()) as { ok?: boolean; device?: string };
    return body.ok ? (body.device ?? "reader") : null;
  } catch {
    return null;
  }
}

/** Ask the helper to read the card in the reader (waits up to 30 s for a card). */
export async function bridgeRead(): Promise<CardRead | null> {
  const res = await fetch(`${BRIDGE_URL}/read`, { method: "POST", signal: AbortSignal.timeout(30_000), cache: "no-store" });
  if (!res.ok) throw new Error(`reader ${res.status}`);
  return fromBridge(await res.json());
}

/** Fictional test card ("TEST CARD", valid check digits) for trying the flow without a device. */
export const SPECIMEN_MRZ = [
  "IDOMNT0000001<6<<<<<<<<<<<<<<<",
  "9001011M3104150OMN<<<<<<<<<<<4",
  "TEST<<CARD<<<<<<<<<<<<<<<<<<<<",
].join("\n");
