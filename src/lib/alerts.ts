import "server-only";
import { cache } from "react";
import type { Ctx } from "./auth";
import { can } from "./auth";
import type { Dict, DictKey } from "./i18n/dict";
import { gregorian, omr } from "./format";
import type { AlertItem } from "@/components/AlertsBell";

// Isolate each part so Latin names and dates don't reorder inside Arabic text
const iso = (x: string) => `\u2068${x}\u2069`;
const join = (parts: (string | null | undefined)[]) => parts.filter(Boolean).map((x) => iso(x!)).join(" · ");

type Row = { kind: string; severity: number; ref_id: string; unit: string | null; guest: string | null; info: string | null };

/** Today's alerts for the current user, translated and linked to where they're handled (once per request). */
export const loadAlerts = cache(async (ctx: Ctx, t: Dict, lang: "ar" | "en" | "ur" | "bn"): Promise<AlertItem[]> => {
  const [{ data }, complaints] = await Promise.all([
    ctx.supabase.rpc("alerts", { p_property: ctx.property.id }),
    // new staff complaints, for the owner only (managers never see them)
    ctx.role === "owner"
      ? ctx.supabase.from("staff_complaints").select("id", { count: "exact", head: true }).eq("tenant_id", ctx.tenantId).eq("status", "new").then((r) => r.count ?? 0)
      : Promise.resolve(0),
  ]);
  const extraAlerts: AlertItem[] = complaints > 0
    ? [{ key: "staff-complaints", severity: 1, title: t.al_staff_complaint, detail: String(complaints), href: "/complaints" }]
    : [];
  return extraAlerts.concat(((data ?? []) as Row[]).map((r, i) => {
    const unit = r.unit ? `${t.unit} ${r.unit}` : "";
    const who = r.guest ?? "";
    let extra: string | null = null;
    let href = can(ctx, "reservations") ? `/reservations/${r.ref_id}` : "/board";
    switch (r.kind) {
      case "arrival_unit_not_ready":
        extra = r.info ? (t[`st_${r.info}` as DictKey] ?? r.info) : null;
        href = can(ctx, "housekeeping") ? "/housekeeping" : href;
        break;
      case "late_checkout":
      case "possible_no_show":
      case "document_expired":
        extra = r.info ? gregorian(r.info, lang) : null;
        break;
      case "rent_due":
        extra = r.info ? gregorian(r.info, lang) : null;
        href = "/finance";
        break;
      case "shift_open_long":
        href = "/finance";
        break;
      case "cash_shortage":
        extra = r.info ? omr(Number(r.info), lang) : null;
        href = "/finance";
        break;
      case "correction_pending":
        extra = r.info ? (t[`cr_target_${r.info}` as DictKey] ?? r.info) : null;
        href = "/finance/corrections";
        break;
      case "cheque_due":
        extra = r.info ? gregorian(r.info, lang) : null;
        href = "/finance/cheques";
        break;
      case "cheque_bounced":
        extra = r.info ? omr(Number(r.info), lang) : null;
        href = "/finance/cheques";
        break;
      case "contract_ending":
        extra = r.info ? gregorian(r.info, lang) : null;
        break;
      case "work_card_expiring":
        extra = r.info ? gregorian(r.info, lang) : null;
        href = `/profile/${r.ref_id}`;
        break;
      case "payment_proof":
        extra = r.info ? omr(Number(r.info), lang) : null;
        href = "/finance/links";
        break;
      case "channel_conflict":
      case "channel_sync_error":
        extra = r.kind === "channel_conflict" ? (r.info ? gregorian(r.info, lang) : null) : r.info;
        href = "/channels";
        break;
      case "messages_due":
        extra = r.info;
        href = "/messages";
        break;
      case "staff_notice":
        extra = r.info;
        href = "/messages";
        break;
      case "new_complaint":
        extra = r.info;
        href = "/feedback";
        break;
      case "urgent_maintenance":
        extra = r.info;
        href = "/maintenance";
        break;
    }
    const detail = r.kind === "urgent_maintenance" ? join([unit, extra]) : join([unit, who, extra]);
    return { key: `${r.kind}-${r.ref_id}-${i}`, severity: r.severity, title: t[`al_${r.kind}` as DictKey] ?? r.kind, detail, href };
  }));
});
