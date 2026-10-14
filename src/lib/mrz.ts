"use client";

import { parse } from "mrz";

export type ScannedGuest = {
  full_name?: string;
  nationality?: string;
  doc_type?: "oman_id" | "gcc_id" | "passport" | "resident_card" | "other";
  doc_number?: string;
  doc_expiry?: string;
  date_of_birth?: string;
  gender?: "M" | "F";
  valid: boolean;
};

const GCC = new Set(["ARE", "SAU", "KWT", "BHR", "QAT"]);

function yymmdd(v: string | null | undefined, kind: "birth" | "expiry"): string | undefined {
  if (!v || !/^\d{6}$/.test(v)) return undefined;
  const yy = Number(v.slice(0, 2));
  const nowYY = new Date().getFullYear() % 100;
  const century = kind === "expiry" ? 2000 : yy > nowYY ? 1900 : 2000;
  return `${century + yy}-${v.slice(2, 4)}-${v.slice(4, 6)}`;
}

/** Find MRZ lines in OCR text (TD1 = 3×30, TD2 = 2×36, TD3 = 2×44). */
export function extractMrz(text: string): string[] | null {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/\s/g, "").replace(/[«‹]/g, "<").toUpperCase())
    .filter((l) => /^[A-Z0-9<]{25,48}$/.test(l) && l.includes("<"));
  for (const len of [44, 36, 30]) {
    const fit = lines.filter((l) => Math.abs(l.length - len) <= 2).map((l) => l.padEnd(len, "<").slice(0, len));
    const need = len === 30 ? 3 : 2;
    if (fit.length >= need) return fit.slice(-need);
  }
  return null;
}

export function mrzToGuest(lines: string[]): ScannedGuest {
  const r = parse(lines, { autocorrect: true });
  const f = r.fields;
  const state = f.issuingState ?? undefined;
  const nationality = f.nationality ?? state;
  const code = f.documentCode ?? "";
  let doc_type: ScannedGuest["doc_type"] = "other";
  if (code.startsWith("P")) doc_type = "passport";
  else if (state === "OMN" && nationality === "OMN") doc_type = "oman_id";
  else if (state === "OMN") doc_type = "resident_card";
  else if (state && GCC.has(state)) doc_type = "gcc_id";
  const name = [f.firstName, f.lastName].filter(Boolean).join(" ").trim();
  return {
    full_name: name || undefined,
    nationality: nationality || undefined,
    doc_type,
    doc_number: (f.documentNumber ?? undefined)?.replace(/</g, ""),
    doc_expiry: yymmdd(f.expirationDate, "expiry"),
    date_of_birth: yymmdd(f.birthDate, "birth"),
    gender: f.sex === "male" ? "M" : f.sex === "female" ? "F" : undefined,
    valid: r.valid,
  };
}

/** OCR an ID/passport photo in the browser (no image leaves the device for OCR). */
export async function scanDocument(file: File): Promise<ScannedGuest | null> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({ tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<" });
    const { data } = await worker.recognize(file);
    const lines = extractMrz(data.text);
    return lines ? mrzToGuest(lines) : null;
  } finally {
    await worker.terminate();
  }
}
