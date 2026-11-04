import "server-only";
import type { Ctx } from "./auth";
import { gregorian, omr, parseRange } from "./format";
import { feedbackUrl, appUrl } from "./feedback-qr";

/** Built-in guest messages. A hotel can override the wording (message_templates) or add its own keys. */
export const DEFAULT_TEMPLATES: Record<string, { name_ar: string; name_en: string; body_ar: string; body_en: string }> = {
  booking_confirmed: {
    name_ar: "تأكيد الحجز",
    name_en: "Booking confirmation",
    body_ar: "مرحباً {guest}، تم تأكيد حجزكم في {hotel}.\nرقم الحجز: {code}\nالوحدة: {unit}\nالوصول: {from} — المغادرة: {to}\nنتشرف باستقبالكم.",
    body_en: "Hello {guest}, your booking at {hotel} is confirmed.\nRef: {code}\nUnit: {unit}\nArrival: {from} — Departure: {to}\nWe look forward to welcoming you.",
  },
  pre_arrival: {
    name_ar: "تذكير قبل الوصول",
    name_en: "Pre-arrival reminder",
    body_ar: "مرحباً {guest}، نذكّركم بموعد وصولكم إلى {hotel} يوم {from}. تسجيل الدخول من الساعة {checkin_time}.\nللاستفسار: {hotel_phone}",
    body_en: "Hello {guest}, a reminder of your arrival at {hotel} on {from}. Check-in from {checkin_time}.\nQuestions: {hotel_phone}",
  },
  payment_request: {
    name_ar: "طلب دفع",
    name_en: "Payment request",
    body_ar: "مرحباً {guest}، المبلغ المتبقي على حسابكم في {hotel}: {balance}.\nللدفع: {pay_link}",
    body_en: "Hello {guest}, the balance on your account at {hotel} is {balance}.\nPay here: {pay_link}",
  },
  checkout_thanks: {
    name_ar: "شكر بعد المغادرة وطلب التقييم",
    name_en: "Thank you + review request",
    body_ar: "شكراً لإقامتكم في {hotel} يا {guest}. يسعدنا سماع رأيكم: {review_link}",
    body_en: "Thank you for staying at {hotel}, {guest}. We'd love your feedback: {review_link}",
  },
  contract_renewal: {
    name_ar: "قرب انتهاء العقد",
    name_en: "Contract ending",
    body_ar: "مرحباً {guest}، عقدكم للوحدة {unit} في {hotel} ينتهي يوم {to}. هل ترغبون بالتجديد؟ تواصلوا معنا: {hotel_phone}",
    body_en: "Hello {guest}, your contract for unit {unit} at {hotel} ends on {to}. Would you like to renew? Contact us: {hotel_phone}",
  },
  contract_sign: {
    name_ar: "توقيع العقد",
    name_en: "Contract to sign",
    body_ar: "مرحباً {guest}، عقد الإيجار للوحدة {unit} في {hotel} جاهز للتوقيع الإلكتروني: {sign_link}",
    body_en: "Hello {guest}, your rental contract for unit {unit} at {hotel} is ready to sign: {sign_link}",
  },
};

export const PLACEHOLDERS = ["guest", "hotel", "unit", "code", "from", "to", "checkin_time", "hotel_phone", "balance", "pay_link", "review_link", "sign_link"] as const;

export type Template = { key: string; name: string; body_ar: string; body_en: string; custom: boolean; edited: boolean };

/** Defaults merged with the hotel's own wording. */
export async function loadTemplates(ctx: Ctx, lang: string): Promise<Template[]> {
  const { data } = await ctx.supabase.from("message_templates").select("key, name, body_ar, body_en").eq("tenant_id", ctx.tenantId);
  const own = new Map((data ?? []).map((r) => [r.key as string, r]));
  const list: Template[] = Object.entries(DEFAULT_TEMPLATES).map(([key, d]) => {
    const o = own.get(key);
    return { key, name: lang === "ar" ? d.name_ar : d.name_en, body_ar: o?.body_ar ?? d.body_ar, body_en: o?.body_en ?? d.body_en, custom: false, edited: Boolean(o) };
  });
  for (const [key, o] of own) if (!DEFAULT_TEMPLATES[key]) list.push({ key, name: o.name, body_ar: o.body_ar, body_en: o.body_en, custom: true, edited: true });
  return list;
}

/** Fill {placeholders}. A missing value (e.g. no payment link yet) takes its "label:" with it; empty lines are dropped. */
export function fill(body: string, vars: Partial<Record<(typeof PLACEHOLDERS)[number], string | null>>): string {
  return body
    .split("\n")
    .map((line) => {
      let out = line;
      for (const k of PLACEHOLDERS) {
        const v = vars[k];
        out = v
          ? out.replaceAll(`{${k}}`, v)
          : out.replace(new RegExp(`[^.!?؟،,\\n]*[:：]\\s*\\{${k}\\}`, "g"), "").replaceAll(`{${k}}`, "");
      }
      return out.trimEnd();
    })
    .filter((l) => l.trim() !== "" && !/^[\s.,:،؛-]+$/.test(l))
    .join("\n")
    .trim();
}

type Res = {
  id: string; code: string; stay: string; kind: string;
  units: { number: string } | null;
  guests: { full_name: string; phone: string | null; preferred_language: string } | null;
};

/** Text of each queued message, in the guest's language, with live values and links. */
export async function renderOutbox(
  ctx: Ctx,
  rows: { id: string; template_key: string; reservation_id: string | null; payload: Record<string, unknown> }[],
  templates: Template[],
) {
  const resIds = [...new Set(rows.map((r) => r.reservation_id).filter(Boolean))] as string[];
  const [{ data: resList }, { data: prop }] = await Promise.all([
    resIds.length
      ? ctx.supabase.from("reservations").select("id, code, stay, kind, units(number), guests(full_name, phone, preferred_language)").in("id", resIds)
      : Promise.resolve({ data: [] as Res[] }),
    ctx.supabase.from("properties").select("name_ar, name_en, phone, whatsapp, check_in_time, feedback_token").eq("id", ctx.property.id).single(),
  ]);
  const resById = new Map(((resList ?? []) as unknown as Res[]).map((r) => [r.id, r]));
  const balances = new Map<string, number>();
  await Promise.all(
    resIds.map(async (id) => {
      const { data: f } = await ctx.supabase.from("folios").select("id").eq("reservation_id", id).maybeSingle();
      if (!f) return;
      const { data: s } = await ctx.supabase.rpc("folio_summary", { p_folio: f.id });
      balances.set(id, Number((s as { balance?: number } | null)?.balance ?? 0));
    }),
  );
  const review = prop?.feedback_token ? await feedbackUrl(prop.feedback_token as string) : null;
  const byKey = new Map(templates.map((t) => [t.key, t]));

  return Promise.all(
    rows.map(async (m) => {
      const r = m.reservation_id ? resById.get(m.reservation_id) : undefined;
      const en = r?.guests?.preferred_language === "en";
      const t = byKey.get(m.template_key);
      const stay = r ? parseRange(r.stay) : null;
      const L = en ? "en" : "ar";
      const balance = r ? balances.get(r.id) ?? 0 : 0;
      const payToken = typeof m.payload.payment_link_token === "string" ? m.payload.payment_link_token : null;
      const signToken = typeof m.payload.sign_token === "string" ? m.payload.sign_token : null;
      const text = t
        ? fill(en ? t.body_en : t.body_ar, {
            guest: r?.guests?.full_name?.split(" ")[0] ?? "",
            hotel: (en && prop?.name_en) || prop?.name_ar || ctx.property.name_ar,
            unit: r?.units?.number ?? "",
            code: r?.code ?? "",
            from: stay ? gregorian(stay.from, L) : "",
            to: stay ? gregorian(stay.to, L) : "",
            checkin_time: String(prop?.check_in_time ?? "").slice(0, 5),
            hotel_phone: (prop?.whatsapp as string | null) || (prop?.phone as string | null) || "",
            balance: balance > 0 ? omr(balance, L) : null,
            pay_link: payToken ? await appUrl(`/p/${payToken}`) : null,
            review_link: review,
            sign_link: signToken ? await appUrl(`/s/${signToken}`) : null,
          })
        : "";
      return { id: m.id, text, phone: r?.guests?.phone ?? null, guest: r?.guests?.full_name ?? "", unit: r?.units?.number ?? "", reservationId: r?.id ?? null, template: t?.name ?? m.template_key };
    }),
  );
}
