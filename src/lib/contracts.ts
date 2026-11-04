import "server-only";
import type { Ctx } from "./auth";
import type { Dict, DictKey } from "./i18n/dict";
import { gregorian, omr, parseRange, todayIn } from "./format";

/** Starting wording for a furnished-unit lease. The owner edits it in Settings > Automation. */
export const DEFAULT_CONTRACT = `عقد إيجار وحدة مفروشة
رقم الحجز: {contract_no} — تاريخ العقد: {date}

الطرف الأول (المؤجر): {hotel}، العنوان: {hotel_address}، رقم الترخيص: {license_no}، الهاتف: {hotel_phone}.
الطرف الثاني (المستأجر): {guest}، {guest_doc_type} رقم {guest_doc}، الجنسية: {nationality}، الهاتف: {guest_phone}.

1. الوحدة: يؤجر الطرف الأول للطرف الثاني الوحدة رقم {unit} ({unit_type}) مفروشة وجاهزة للسكن.
2. المدة: من {from} إلى {to}.
3. الإيجار: {rent}، يُستحق في اليوم {billing_day} من كل شهر.
4. التأمين: {deposit}، يُرد عند انتهاء العقد بعد خصم أي أضرار أو مبالغ مستحقة.
5. الخدمات: {utilities}.
6. يلتزم المستأجر بالمحافظة على الوحدة ومحتوياتها، وبعدم إجراء أي تعديل أو التأجير من الباطن دون موافقة كتابية من المؤجر.
7. يبلغ المستأجر عن أي عطل فوراً، ويتحمل تكلفة الأضرار الناتجة عن سوء الاستخدام.
8. يحق للمؤجر دخول الوحدة للصيانة بعد إشعار مسبق، إلا في الحالات الطارئة.
9. من يرغب في إنهاء العقد قبل انتهاء مدته يُشعر الطرف الآخر قبل 30 يوماً.
10. تسري على هذا العقد أنظمة سلطنة عُمان، ويُعد التوقيع الإلكتروني عليه ملزماً للطرفين.

شروط إضافية: {terms}`;

export const CONTRACT_PLACEHOLDERS = [
  "contract_no", "date", "hotel", "hotel_address", "license_no", "hotel_phone", "guest", "guest_doc_type", "guest_doc", "nationality",
  "guest_phone", "unit", "unit_type", "from", "to", "rent", "deposit", "billing_day", "utilities", "terms",
] as const;

type ResRow = {
  code: string; stay: string; kind: string; room_total: number; discount_amount: number;
  guests: { full_name: string; doc_type: string | null; doc_number: string | null; nationality: string | null; phone: string | null } | null;
  units: { number: string; unit_types: { name_ar: string } | null } | null;
  contracts: { monthly_rent: number; deposit_amount: number; billing_day: number; electricity_included: boolean; water_included: boolean; terms: string | null } | null;
};

/** The contract text for one booking: the hotel's template filled with today's values (then frozen when issued). */
export async function renderContract(ctx: Ctx, t: Dict, reservationId: string): Promise<string | null> {
  const [{ data: r }, { data: tenant }, { data: prop }] = await Promise.all([
    ctx.supabase
      .from("reservations")
      .select("code, stay, kind, room_total, discount_amount, guests(full_name, doc_type, doc_number, nationality, phone), units(number, unit_types(name_ar)), contracts(monthly_rent, deposit_amount, billing_day, electricity_included, water_included, terms)")
      .eq("id", reservationId)
      .maybeSingle(),
    ctx.supabase.from("tenants").select("contract_template").eq("id", ctx.tenantId).single(),
    ctx.supabase.from("properties").select("name_ar, address, license_no, phone, whatsapp").eq("id", ctx.property.id).single(),
  ]);
  if (!r) return null;
  const row = r as unknown as ResRow;
  const stay = parseRange(row.stay);
  const ct = Array.isArray(row.contracts) ? row.contracts[0] : row.contracts;
  const utilities = ct
    ? [ct.electricity_included ? t.ct_elec_in : t.ct_elec_out, ct.water_included ? t.ct_water_in : t.ct_water_out].join("، ")
    : t.ct_utilities_included;
  const vars: Record<(typeof CONTRACT_PLACEHOLDERS)[number], string | null | undefined> = {
    contract_no: row.code,
    date: gregorian(todayIn(ctx.property.timezone), "ar"),
    hotel: prop?.name_ar,
    hotel_address: prop?.address,
    license_no: prop?.license_no,
    hotel_phone: prop?.whatsapp || prop?.phone,
    guest: row.guests?.full_name,
    guest_doc_type: row.guests?.doc_type ? t[`dt_${row.guests.doc_type}` as DictKey] : t.doc_number,
    guest_doc: row.guests?.doc_number,
    nationality: row.guests?.nationality,
    guest_phone: row.guests?.phone,
    unit: row.units?.number,
    unit_type: row.units?.unit_types?.name_ar,
    from: gregorian(stay.from, "ar"),
    to: gregorian(stay.to, "ar"),
    rent: ct ? `${omr(ct.monthly_rent, "ar")} ${t.ct_per_month}` : omr(row.room_total - row.discount_amount, "ar"),
    deposit: ct ? omr(ct.deposit_amount, "ar") : omr(0, "ar"),
    billing_day: ct ? String(ct.billing_day) : "—",
    utilities,
    terms: ct?.terms,
  };
  const template = (tenant?.contract_template as string | null) || DEFAULT_CONTRACT;
  return template.replace(/\{([a-z_]+)\}/g, (m, k: string) =>
    (CONTRACT_PLACEHOLDERS as readonly string[]).includes(k) ? (vars[k as keyof typeof vars] || "—") : m,
  );
}
