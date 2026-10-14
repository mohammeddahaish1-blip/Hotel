import type { Dict } from "./i18n/dict";

/** Map a database error ("CODE: detail") to a translated, user-facing message. */
export function errorMessage(t: Dict, err: { message?: string } | string | null | undefined): string {
  const msg = typeof err === "string" ? err : (err?.message ?? "");
  const code = /^([A-Z_]+):/.exec(msg)?.[1];
  if (code) {
    const key = `err_${code}` as keyof Dict;
    if (key in t) return t[key];
  }
  if (msg.includes("consent_at")) return t.err_consent;
  if (msg.includes("row-level security") || msg.includes("permission denied")) return t.err_FORBIDDEN;
  return msg || t.err_generic;
}
