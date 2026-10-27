import type { Dict, DictKey } from "@/lib/i18n/dict";
import { dateTime, gregorian, omr, parseRange, pct } from "@/lib/format";

export type AuditRow = {
  id: number;
  table_name: string;
  record_id: string | null;
  action: "insert" | "update" | "delete" | string;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  actor: string | null;
  at: string;
};

/** Names the page resolves once (ids → human labels) so every row reads in plain language. */
export type AuditLookups = {
  staff: Map<string, string>;
  units: Map<string, string>;
  guests: Map<string, string>;
  /** folio id → its reservation (charges/payments link back to the stay) */
  folios: Map<string, { reservationId: string | null; code: string | null }>;
  reservations: Map<string, string>;
  tz: string;
};

export type AuditChange = { field: string; label: string; before: string | null; after: string };
export type AuditView = { summary: string; changes: AuditChange[]; href: string | null; sensitive: boolean };

export const AUDIT_TABLES = [
  "reservations", "payments", "charges", "invoices", "credit_notes", "expenses", "cash_shifts",
  "unit_types", "rate_plans", "tax_rules", "maintenance_tickets", "compliance_submissions", "memberships", "invitations", "feedback", "cheques", "correction_requests", "unit_owners", "owner_payouts",
] as const;

const L = {
  ar: {
    tables: {
      reservations: "الحجوزات", payments: "المدفوعات", charges: "الرسوم", invoices: "الفواتير",
      credit_notes: "الإشعارات الدائنة", expenses: "المصروفات", cash_shifts: "الصندوق",
      unit_types: "أنواع الوحدات", rate_plans: "خطط الأسعار", tax_rules: "الضرائب",
      maintenance_tickets: "الصيانة", compliance_submissions: "الامتثال", memberships: "الموظفون", invitations: "الدعوات",
      feedback: "المقترحات والشكاوي", cheques: "الشيكات", correction_requests: "طلبات التصحيح",
      unit_owners: "ملاك الوحدات", owner_payouts: "دفعات الملاك",
    } as Record<string, string>,
    actions: { insert: "إضافة", update: "تعديل", delete: "حذف" } as Record<string, string>,
    fields: {
      status: "الحالة", stay: "فترة الإقامة", unit_id: "الوحدة", guest_id: "النزيل", code: "رقم الحجز", kind: "النوع",
      source: "المصدر", adults: "البالغون", children: "الأطفال", room_total: "إجمالي الإقامة", discount_amount: "الخصم",
      notes: "ملاحظات", checked_in_at: "وقت الدخول", checked_out_at: "وقت الخروج", cancelled_at: "وقت الإلغاء",
      cancel_reason: "سبب الإلغاء", amount: "المبلغ", method: "طريقة الدفع", reference: "المرجع", received_at: "وقت الاستلام",
      voided_at: "وقت الإلغاء", void_reason: "سبب الإلغاء", description: "الوصف", taxable: "خاضع للضريبة",
      service_date: "تاريخ الخدمة", invoice_id: "الفاتورة", series: "السلسلة", number: "الرقم", issued_at: "تاريخ الإصدار",
      language: "اللغة", subtotal: "قبل الضريبة", tax_total: "الضريبة", total: "الإجمالي", fawtara_status: "حالة فوترة",
      fawtara_ref: "مرجع فوترة", reason: "السبب", opened_at: "وقت الفتح", opening_float: "عهدة الافتتاح", closed_at: "وقت الإغلاق",
      closed_by: "أغلقه", expected_cash: "النقد المتوقع", counted_cash: "النقد المعدود", difference: "الفرق",
      category: "البند", expense_date: "تاريخ المصروف", attachment_path: "المرفق", name_ar: "الاسم", name_en: "الاسم (إنجليزي)",
      name: "الاسم", capacity: "السعة", nightly_rate: "سعر الليلة", monthly_rate: "السعر الشهري", period: "الفترة",
      priority: "الأولوية", rate_bp: "النسبة", basis: "الأساس", is_revenue: "إيراد", effective_from: "يسري من",
      effective_to: "يسري إلى", active: "فعّال", title: "العنوان", blocks_availability: "يحجب الوحدة", photo_path: "الصورة",
      assigned_to: "المسؤول", authority: "الجهة", record_count: "عدد السجلات", submitted_at: "وقت الرفع",
      email: "البريد", role: "الدور", full_name: "الاسم", job_title: "المسمى الوظيفي", permissions: "الأقسام المسموحة",
      ui_language: "لغة الواجهة", accepted_at: "وقت القبول", discount_approved_by: "اعتمد الخصم",
      message: "الرسالة", rating: "التقييم", guest_name: "اسم النزيل", contact: "التواصل", room: "الغرفة",
      staff_notes: "ملاحظات الإدارة", handled_by: "عالجها", handled_at: "وقت المعالجة",
    } as Record<string, string>,
    empty: "(فارغ)", yes: "نعم", no: "لا", system: "النظام (تلقائي)", defaults: "حسب الدور",
    // summaries
    res_new: (c: string) => `أنشأ الحجز ${c}`,
    res_status: (c: string, a: string, b: string) => `غيّر حالة الحجز ${c}: ${a} ← ${b}`,
    res_edit: (c: string) => `عدّل الحجز ${c}`,
    res_del: (c: string) => `حذف الحجز ${c}`,
    pay_new: (k: string, a: string, m: string) => `سجّل ${k} ${a} (${m})`,
    pay_void: (a: string) => `ألغى دفعة بقيمة ${a}`,
    chg_new: (d: string, a: string) => `أضاف رسوم «${d}» بقيمة ${a}`,
    chg_void: (d: string, a: string) => `ألغى رسوم «${d}» بقيمة ${a}`,
    inv_new: (n: string, a: string) => `أصدر الفاتورة ${n} بقيمة ${a}`,
    cn_new: (n: string, a: string) => `أصدر إشعاراً دائناً ${n} بقيمة ${a}`,
    exp_new: (d: string, a: string) => `أضاف مصروف «${d}» بقيمة ${a}`,
    exp_edit: (d: string) => `عدّل المصروف «${d}»`,
    exp_del: (d: string, a: string) => `حذف المصروف «${d}» بقيمة ${a}`,
    shift_open: (a: string) => `فتح الصندوق بعهدة ${a}`,
    shift_close: (d: string) => `أغلق الصندوق — الفرق ${d}`,
    mt_new: (t: string, u: string) => `فتح بلاغ صيانة «${t}» للوحدة ${u}`,
    mt_status: (t: string, s: string) => `غيّر بلاغ «${t}» إلى ${s}`,
    member_perm: (n: string) => `غيّر صلاحيات ${n}`,
    member_role: (n: string, a: string, b: string) => `غيّر دور ${n}: ${a} ← ${b}`,
    member_active: (n: string, on: boolean) => (on ? `فعّل حساب ${n}` : `أوقف حساب ${n}`),
    member_new: (n: string) => `انضم ${n} إلى الفريق`,
    invite_new: (n: string, e: string) => `دعا ${n} (${e})`,
    generic: (a: string, what: string, name: string) => `${a} ${what}${name ? ` «${name}»` : ""}`,
    what: {
      unit_types: "نوع وحدة", rate_plans: "خطة سعر", tax_rules: "ضريبة", compliance_submissions: "سجل امتثال",
      memberships: "بيانات موظف", invitations: "دعوة", maintenance_tickets: "بلاغ صيانة", invoices: "فاتورة",
      reservations: "حجز", payments: "دفعة", charges: "رسوم", expenses: "مصروف", cash_shifts: "وردية صندوق", credit_notes: "إشعار دائن",
      feedback: "ملاحظة نزيل", cheques: "شيك", correction_requests: "طلب تصحيح", unit_owners: "مالك وحدة", owner_payouts: "دفعة لمالك",
    } as Record<string, string>,
    verb: { insert: "أضاف", update: "عدّل", delete: "حذف" } as Record<string, string>,
  },
  en: {
    tables: {
      reservations: "Reservations", payments: "Payments", charges: "Charges", invoices: "Invoices",
      credit_notes: "Credit notes", expenses: "Expenses", cash_shifts: "Cash drawer",
      unit_types: "Unit types", rate_plans: "Rate plans", tax_rules: "Taxes",
      maintenance_tickets: "Maintenance", compliance_submissions: "Compliance", memberships: "Staff", invitations: "Invitations",
      feedback: "Suggestions & complaints", cheques: "Cheques", correction_requests: "Correction requests",
      unit_owners: "Unit owners", owner_payouts: "Owner payouts",
    } as Record<string, string>,
    actions: { insert: "Added", update: "Edited", delete: "Deleted" } as Record<string, string>,
    fields: {} as Record<string, string>,
    empty: "(empty)", yes: "Yes", no: "No", system: "System (automatic)", defaults: "Role defaults",
    res_new: (c: string) => `Created reservation ${c}`,
    res_status: (c: string, a: string, b: string) => `Reservation ${c}: ${a} → ${b}`,
    res_edit: (c: string) => `Edited reservation ${c}`,
    res_del: (c: string) => `Deleted reservation ${c}`,
    pay_new: (k: string, a: string, m: string) => `Recorded ${k} ${a} (${m})`,
    pay_void: (a: string) => `Voided a payment of ${a}`,
    chg_new: (d: string, a: string) => `Added charge “${d}” ${a}`,
    chg_void: (d: string, a: string) => `Voided charge “${d}” ${a}`,
    inv_new: (n: string, a: string) => `Issued invoice ${n} for ${a}`,
    cn_new: (n: string, a: string) => `Issued credit note ${n} for ${a}`,
    exp_new: (d: string, a: string) => `Added expense “${d}” ${a}`,
    exp_edit: (d: string) => `Edited expense “${d}”`,
    exp_del: (d: string, a: string) => `Deleted expense “${d}” ${a}`,
    shift_open: (a: string) => `Opened the cash drawer with ${a}`,
    shift_close: (d: string) => `Closed the cash drawer — difference ${d}`,
    mt_new: (t: string, u: string) => `Opened maintenance ticket “${t}” for unit ${u}`,
    mt_status: (t: string, s: string) => `Ticket “${t}” → ${s}`,
    member_perm: (n: string) => `Changed ${n}'s permissions`,
    member_role: (n: string, a: string, b: string) => `Changed ${n}'s role: ${a} → ${b}`,
    member_active: (n: string, on: boolean) => (on ? `Activated ${n}` : `Deactivated ${n}`),
    member_new: (n: string) => `${n} joined the team`,
    invite_new: (n: string, e: string) => `Invited ${n} (${e})`,
    generic: (a: string, what: string, name: string) => `${a} ${what}${name ? ` “${name}”` : ""}`,
    what: {
      unit_types: "unit type", rate_plans: "rate plan", tax_rules: "tax", compliance_submissions: "compliance record",
      memberships: "staff details", invitations: "invitation", maintenance_tickets: "maintenance ticket", invoices: "invoice",
      reservations: "reservation", payments: "payment", charges: "charge", expenses: "expense", cash_shifts: "cash shift", credit_notes: "credit note",
      feedback: "guest feedback", cheques: "cheque", correction_requests: "correction request", unit_owners: "unit owner", owner_payouts: "owner payout",
    } as Record<string, string>,
    verb: { insert: "Added", update: "Edited", delete: "Deleted" } as Record<string, string>,
  },
};
export type AuditLang = keyof typeof L | "ur";
// Urdu users (front-line staff) rarely open the audit log: English wording is used for them.
const LL = (lang: AuditLang) => L[lang === "ur" ? "en" : lang];

// Technical columns nobody needs to read
const HIDDEN = new Set([
  "id", "tenant_id", "property_id", "folio_id", "cash_shift_id", "created_at", "updated_at", "created_by", "received_by",
  "issued_by", "invited_by", "opened_by", "reported_by", "user_id", "unit_type_id", "snapshot", "payload", "response", "sort",
]);
const MONEY = new Set([
  "amount", "room_total", "discount_amount", "subtotal", "tax_total", "total", "nightly_rate", "monthly_rate",
  "opening_float", "expected_cash", "counted_cash", "difference",
]);
const TIMES = new Set(["handled_at", "checked_in_at", "checked_out_at", "cancelled_at", "received_at", "voided_at", "issued_at", "opened_at", "closed_at", "submitted_at", "accepted_at"]);
const DATES = new Set(["service_date", "expense_date", "effective_from", "effective_to"]);
const PEOPLE = new Set(["closed_by", "assigned_to", "discount_approved_by", "handled_by"]);

export function tableLabel(table: string, lang: AuditLang) {
  return LL(lang).tables[table] ?? table;
}
export function actionLabel(action: string, lang: AuditLang) {
  return LL(lang).actions[action] ?? action;
}
export function actorLabel(actor: string | null, lk: Pick<AuditLookups, "staff">, lang: AuditLang) {
  return actor ? lk.staff.get(actor) ?? actor.slice(0, 8) : LL(lang).system;
}

function fieldLabel(f: string, t: Dict, lang: AuditLang) {
  if (lang !== "ar") return f.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  return L.ar.fields[f] ?? (t[f as DictKey] as string | undefined) ?? f;
}

function dictOr(t: Dict, key: string, fallback: string) {
  const v = t[key as DictKey];
  return typeof v === "string" ? v : fallback;
}

/** One stored value → what a person would write ("28.500 ر.ع", "تحويل بنكي", "مقيم"). */
function formatValue(table: string, field: string, v: unknown, t: Dict, lang: AuditLang, lk: AuditLookups): string {
  const x = LL(lang);
  if (v === null || v === undefined || v === "") return x.empty;
  if (typeof v === "boolean") return v ? x.yes : x.no;
  const s = String(v);
  if (MONEY.has(field)) return omr(Number(v), lang);
  if (field === "rate_bp") return pct(Number(v));
  if (TIMES.has(field)) return dateTime(s, lk.tz, lang);
  if (DATES.has(field)) return gregorian(s, lang);
  if ((field === "stay" || field === "period") && s.includes(",")) {
    const r = parseRange(s);
    return `${gregorian(r.from, lang)} – ${gregorian(r.to, lang)}`;
  }
  if (field === "unit_id") return lk.units.get(s) ?? s.slice(0, 8);
  if (field === "guest_id") return lk.guests.get(s) ?? s.slice(0, 8);
  if (PEOPLE.has(field)) return lk.staff.get(s) ?? s.slice(0, 8);
  if (field === "invoice_id") return "#" + s.slice(0, 8);
  if (field === "method") return dictOr(t, `pm_${s}`, s);
  if (field === "source") return dictOr(t, `src_${s}`, s);
  if (field === "category") return dictOr(t, `ec_${s}`, s);
  if (field === "role") return dictOr(t, `role_${s}`, s);
  if (field === "permissions") return Array.isArray(v) ? v.map((a) => dictOr(t, `nav_${a}`, String(a))).join("، ") : s;
  if (field === "kind") {
    if (table === "payments") return dictOr(t, `pk_${s}`, s);
    if (table === "charges") return dictOr(t, `ck_${s}`, s);
    if (table === "reservations") return dictOr(t, `kind_${s}`, s);
    if (table === "feedback") return dictOr(t, `fb_${s}`, s);
  }
  if (field === "status") {
    if (table === "reservations") return dictOr(t, `rs_${s}`, s);
    if (table === "maintenance_tickets") return dictOr(t, `mt_${s}`, s);
    if (table === "feedback") return dictOr(t, `fb_status_${s}`, s);
  }
  if (Array.isArray(v) || typeof v === "object") return JSON.stringify(v);
  return s;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Turns a raw audit row into a sentence, a readable diff, a link and a "sensitive" flag. */
export function describeAudit(r: AuditRow, t: Dict, lang: AuditLang, lk: AuditLookups): AuditView {
  const x = LL(lang);
  const before = r.old_data ?? {};
  const after = r.new_data ?? {};
  const data = r.action === "delete" ? before : after;
  const fv = (f: string, v: unknown) => formatValue(r.table_name, f, v, t, lang, lk);
  const changed = (f: string) => r.action === "update" && !same(before[f], after[f]);

  // Diff: every visible field that changed (insert/delete: the values that were set)
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDDEN.has(k));
  const changes: AuditChange[] = [];
  for (const k of keys) {
    if (r.action === "update" && same(before[k], after[k])) continue;
    const v = r.action === "delete" ? before[k] : after[k];
    if (r.action !== "update" && (v === null || v === undefined || v === "" || v === false)) continue;
    changes.push({
      field: k,
      label: fieldLabel(k, t, lang),
      before: r.action === "update" ? fv(k, before[k]) : null,
      after: fv(k, v),
    });
  }

  const money = (f: string) => fv(f, data[f]);
  const str = (f: string) => (data[f] == null ? "" : String(data[f]));
  const folio = lk.folios.get(str("folio_id"));
  const resCode = r.table_name === "reservations" ? str("code") : folio?.code ?? "";
  let summary = "";
  let sensitive = r.action === "delete";
  let href: string | null = null;

  switch (r.table_name) {
    case "reservations": {
      const code = resCode || lk.reservations.get(r.record_id ?? "") || "";
      if (r.action === "insert") summary = x.res_new(code);
      else if (r.action === "delete") summary = x.res_del(code);
      else if (changed("status")) summary = x.res_status(code, fv("status", before.status), fv("status", after.status));
      else summary = x.res_edit(code);
      if (changed("status") && after.status === "cancelled") sensitive = true;
      if (changed("discount_amount") && Number(after.discount_amount) > 0) sensitive = true;
      if (changed("room_total")) sensitive = true;
      if (r.action !== "delete" && r.record_id) href = `/reservations/${r.record_id}`;
      break;
    }
    case "payments":
      if (changed("voided_at") && after.voided_at) {
        summary = x.pay_void(money("amount"));
        sensitive = true;
      } else if (r.action === "insert") {
        summary = x.pay_new(fv("kind", data.kind), money("amount"), fv("method", data.method));
        if (data.kind === "refund" || data.kind === "deposit_refund") sensitive = true;
      } else summary = x.generic(x.verb[r.action] ?? r.action, x.what.payments, money("amount"));
      if (folio?.reservationId) href = `/reservations/${folio.reservationId}`;
      break;
    case "charges":
      if (changed("voided_at") && after.voided_at) {
        summary = x.chg_void(str("description") || fv("kind", data.kind), money("amount"));
        sensitive = true;
      } else if (r.action === "insert") {
        summary = x.chg_new(str("description") || fv("kind", data.kind), money("amount"));
        if (data.kind === "discount") sensitive = true;
      } else summary = x.generic(x.verb[r.action] ?? r.action, x.what.charges, str("description"));
      if (folio?.reservationId) href = `/reservations/${folio.reservationId}`;
      break;
    case "invoices":
      summary = r.action === "insert" ? x.inv_new(`${str("series")}-${str("number")}`, money("total")) : x.generic(x.verb[r.action] ?? r.action, x.what.invoices, `${str("series")}-${str("number")}`);
      if (r.record_id) href = `/invoices/${r.record_id}`;
      break;
    case "credit_notes":
      summary = x.cn_new(`${str("series")}-${str("number")}`, money("total"));
      sensitive = true;
      if (data.invoice_id) href = `/invoices/${data.invoice_id}`;
      break;
    case "expenses": {
      const d = str("description") || fv("category", data.category);
      summary = r.action === "insert" ? x.exp_new(d, money("amount")) : r.action === "delete" ? x.exp_del(d, money("amount")) : x.exp_edit(d);
      if (changed("amount")) sensitive = true;
      href = "/finance";
      break;
    }
    case "cash_shifts":
      if (changed("closed_at") && after.closed_at) {
        summary = x.shift_close(money("difference"));
        if (Number(after.difference) < 0) sensitive = true;
      } else summary = r.action === "insert" ? x.shift_open(money("opening_float")) : x.generic(x.verb[r.action] ?? r.action, x.what.cash_shifts, "");
      href = "/finance";
      break;
    case "maintenance_tickets":
      summary = r.action === "insert" ? x.mt_new(str("title"), fv("unit_id", data.unit_id))
        : changed("status") ? x.mt_status(str("title"), fv("status", after.status))
        : x.generic(x.verb[r.action] ?? r.action, x.what.maintenance_tickets, str("title"));
      href = "/maintenance";
      break;
    case "memberships": {
      const n = str("full_name") || lk.staff.get(str("user_id")) || "";
      if (r.action === "insert") summary = x.member_new(n);
      else if (changed("role")) summary = x.member_role(n, fv("role", before.role), fv("role", after.role));
      else if (changed("permissions")) summary = x.member_perm(n);
      else if (changed("active")) summary = x.member_active(n, !!after.active);
      else summary = x.generic(x.verb[r.action] ?? r.action, x.what.memberships, n);
      if (changed("role") || changed("permissions") || changed("active")) sensitive = true;
      if (r.action !== "delete" && data.user_id) href = `/settings/permissions?u=${data.user_id}`;
      // "null" permissions means the role defaults, say so instead of "(empty)"
      for (const c of changes) {
        if (c.field !== "permissions") continue;
        if (before.permissions == null && c.before !== null) c.before = x.defaults;
        if (data.permissions == null && r.action === "update") c.after = x.defaults;
      }
      break;
    }
    case "invitations":
      summary = r.action === "insert" ? x.invite_new(str("full_name"), str("email")) : x.generic(x.verb[r.action] ?? r.action, x.what.invitations, str("full_name"));
      if (r.action === "insert") sensitive = true;
      href = "/settings";
      break;
    case "unit_types":
    case "rate_plans":
    case "tax_rules":
      summary = x.generic(x.verb[r.action] ?? r.action, x.what[r.table_name], str("name_ar") || str("name") || str("code"));
      if (r.action !== "insert" && (changed("nightly_rate") || changed("monthly_rate") || changed("rate_bp") || changed("active"))) sensitive = true;
      href = "/settings";
      break;
    case "feedback": {
      const m = str("message");
      summary = x.generic(x.verb[r.action] ?? r.action, x.what.feedback, m.length > 40 ? `${m.slice(0, 40)}…` : m);
      href = "/feedback";
      break;
    }
    case "cheques":
      summary = x.generic(x.verb[r.action] ?? r.action, x.what.cheques, `${str("cheque_no")} · ${money("amount")}${changed("status") ? ` → ${dictOr(t, `chq_st_${str("status")}`, str("status"))}` : ""}`);
      if (changed("status") && after.status === "bounced") sensitive = true;
      href = data.reservation_id ? `/reservations/${data.reservation_id}` : "/finance/cheques";
      break;
    case "correction_requests":
      summary = x.generic(x.verb[r.action] ?? r.action, x.what.correction_requests, str("reason"));
      if (changed("status")) sensitive = true;
      href = "/finance/corrections";
      break;
    case "unit_owners":
    case "owner_payouts":
      summary = x.generic(x.verb[r.action] ?? r.action, x.what[r.table_name], str("name") || money("amount"));
      if (r.table_name === "owner_payouts") sensitive = true;
      href = "/properties/owners";
      break;
    case "compliance_submissions":
      summary = x.generic(x.verb[r.action] ?? r.action, x.what.compliance_submissions, str("authority").toUpperCase());
      href = "/compliance";
      break;
    default:
      summary = x.generic(x.verb[r.action] ?? r.action, r.table_name, "");
  }
  return { summary, changes, href, sensitive };
}
