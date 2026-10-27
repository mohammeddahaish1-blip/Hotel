import { NextResponse, type NextRequest } from "next/server";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { getCtx, hasRole, type Ctx } from "@/lib/auth";
import { plainOmr } from "@/lib/format";

export const maxDuration = 300;

/** Every row of a table for this account (the API returns 1000 rows per call). */
async function all(ctx: Ctx, table: string, select = "*") {
  const out: Record<string, unknown>[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.supabase.from(table).select(select).eq("tenant_id", ctx.tenantId).range(from, from + 999);
    if (error || !data?.length) break;
    out.push(...(data as unknown as Record<string, unknown>[]));
    if (data.length < 1000) break;
  }
  return out;
}

const money = (keys: string[]) => (r: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(r).map(([k, v]) => [k, keys.includes(k) && v != null ? Number(plainOmr(v as number)) : v]));

// Sheet name → table, Arabic column headers, money columns (baisa → OMR)
const SHEETS: { name: string; table: string; cols: [string, string][]; money?: string[] }[] = [
  { name: "العقارات", table: "properties", cols: [["name_ar", "الاسم"], ["name_en", "الاسم (EN)"], ["kind", "النوع"], ["address", "العنوان"], ["phone", "الهاتف"], ["license_no", "الترخيص"], ["vat_no", "الرقم الضريبي"]] },
  { name: "أنواع الوحدات", table: "unit_types", cols: [["name_ar", "النوع"], ["kind", "الفئة"], ["capacity", "السعة"], ["nightly_rate", "سعر الليلة"], ["monthly_rate", "السعر الشهري"]], money: ["nightly_rate", "monthly_rate"] },
  { name: "الوحدات", table: "units", cols: [["number", "رقم الوحدة"], ["status", "الحالة"], ["unit_type_id", "النوع"], ["owner_id", "المالك"], ["active", "فعّالة"]] },
  { name: "ملاك الوحدات", table: "unit_owners", cols: [["name", "الاسم"], ["phone", "الهاتف"], ["email", "البريد"], ["commission_bp", "العمولة (نقطة أساس)"]] },
  { name: "النزلاء", table: "guests", cols: [["full_name", "الاسم"], ["phone", "الهاتف"], ["email", "البريد"], ["nationality", "الجنسية"], ["doc_type", "نوع الوثيقة"], ["doc_number", "رقم الوثيقة"], ["doc_expiry", "انتهاء الوثيقة"], ["created_at", "تاريخ التسجيل"]] },
  { name: "الحجوزات", table: "reservations", cols: [["code", "الرقم"], ["stay", "الفترة"], ["kind", "النوع"], ["status", "الحالة"], ["source", "المصدر"], ["room_total", "الإجمالي"], ["discount_amount", "الخصم"], ["unit_id", "الوحدة"], ["guest_id", "النزيل"]], money: ["room_total", "discount_amount"] },
  { name: "الرسوم", table: "charges", cols: [["service_date", "التاريخ"], ["kind", "النوع"], ["description", "الوصف"], ["amount", "المبلغ"], ["voided_at", "أُلغي في"], ["void_reason", "سبب الإلغاء"]], money: ["amount"] },
  { name: "المدفوعات", table: "payments", cols: [["receipt_no", "رقم السند"], ["received_at", "التاريخ"], ["kind", "النوع"], ["method", "الطريقة"], ["amount", "المبلغ"], ["reference", "المرجع"], ["voided_at", "أُلغي في"], ["void_reason", "سبب الإلغاء"]], money: ["amount"] },
  { name: "الفواتير", table: "invoices", cols: [["series", "السلسلة"], ["number", "الرقم"], ["issued_at", "التاريخ"], ["subtotal", "قبل الضريبة"], ["tax_total", "الضريبة"], ["total", "الإجمالي"]], money: ["subtotal", "tax_total", "total"] },
  { name: "الإشعارات الدائنة", table: "credit_notes", cols: [["series", "السلسلة"], ["number", "الرقم"], ["issued_at", "التاريخ"], ["reason", "السبب"], ["total", "الإجمالي"]], money: ["total"] },
  { name: "المصروفات", table: "expenses", cols: [["expense_date", "التاريخ"], ["category", "البند"], ["description", "الوصف"], ["method", "الطريقة"], ["amount", "المبلغ"], ["archived_at", "مؤرشف في"], ["archive_reason", "سبب الأرشفة"]], money: ["amount"] },
  { name: "الشيكات", table: "cheques", cols: [["cheque_no", "رقم الشيك"], ["bank", "البنك"], ["due_date", "الاستحقاق"], ["amount", "المبلغ"], ["status", "الحالة"], ["bounce_reason", "سبب الارتجاع"]], money: ["amount"] },
  { name: "دفعات الملاك", table: "owner_payouts", cols: [["paid_on", "التاريخ"], ["owner_id", "المالك"], ["amount", "المبلغ"], ["method", "الطريقة"], ["reference", "المرجع"]], money: ["amount"] },
  { name: "ورديات الصندوق", table: "cash_shifts", cols: [["opened_at", "الفتح"], ["closed_at", "الإغلاق"], ["opening_float", "العهدة"], ["expected_cash", "المتوقع"], ["counted_cash", "المعدود"], ["difference", "الفرق"]], money: ["opening_float", "expected_cash", "counted_cash", "difference"] },
  { name: "الموظفون", table: "memberships", cols: [["full_name", "الاسم"], ["job_title", "المسمى"], ["role", "الدور"], ["active", "فعّال"], ["created_at", "الانضمام"]] },
];

async function buildExcel(ctx: Ctx) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Nuzul";
  const index = wb.addWorksheet("الفهرس", { views: [{ rightToLeft: true }] });
  index.addRow(["نسخة كاملة من بيانات نُزُل", new Date().toISOString().slice(0, 16).replace("T", " ")]);
  index.addRow([]);
  index.addRow(["الورقة", "عدد السجلات"]);
  for (const sh of SHEETS) {
    const rows = (await all(ctx, sh.table, ["id", ...sh.cols.map((c) => c[0])].join(", "))).map(money(sh.money ?? []));
    const ws = wb.addWorksheet(sh.name, { views: [{ rightToLeft: true, state: "frozen", ySplit: 1 }] });
    ws.columns = [{ header: "المعرّف", key: "id", width: 38 }, ...sh.cols.map(([key, header]) => ({ header, key, width: Math.max(14, header.length + 4) }))];
    ws.getRow(1).font = { bold: true };
    rows.forEach((r) => ws.addRow(r));
    index.addRow([sh.name, rows.length]);
  }
  index.getColumn(1).width = 28;
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function buildZip(ctx: Ctx) {
  const zip = new JSZip();
  const add = async (bucket: string, folder: string, items: { path: unknown; name: string }[]) => {
    for (const it of items) {
      if (typeof it.path !== "string") continue;
      const { data } = await ctx.supabase.storage.from(bucket).download(it.path);
      if (data) zip.file(`${folder}/${it.name.replace(/[\\/:*?"<>|]/g, "_")}-${it.path.split("/").pop()}`, Buffer.from(await data.arrayBuffer()));
    }
  };
  const guests = new Map((await all(ctx, "guests", "id, full_name")).map((g) => [g.id as string, g.full_name as string]));
  await add("guest-docs", "هويات النزلاء", (await all(ctx, "guest_documents", "storage_path, guest_id")).map((d) => ({ path: d.storage_path, name: guests.get(d.guest_id as string) ?? "guest" })));
  await add("expense-receipts", "إيصالات المصروفات", (await all(ctx, "expenses", "attachment_path, expense_date, description")).map((e) => ({ path: e.attachment_path, name: `${e.expense_date}-${e.description}` })));
  await add("payment-proofs", "إثباتات المدفوعات", (await all(ctx, "payments", "proof_path, receipt_no")).map((p) => ({ path: p.proof_path, name: `سند-${p.receipt_no}` })));
  await add("cheque-photos", "صور الشيكات", (await all(ctx, "cheques", "photo_path, cheque_no")).map((c) => ({ path: c.photo_path, name: `شيك-${c.cheque_no}` })));
  await add("property-photos", "صور العقارات", (await all(ctx, "properties", "photo_path, name_ar")).map((p) => ({ path: p.photo_path, name: p.name_ar as string })));
  // documents the guest-docs retention job has already removed simply aren't there any more
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

/** Owner/manager: the whole account as one Excel file, or every stored document as a ZIP. */
export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  if (!hasRole(ctx, ["manager"])) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const kind = req.nextUrl.searchParams.get("kind") === "docs" ? "docs" : "excel";
  const stamp = new Date().toISOString().slice(0, 10);
  const body = kind === "excel" ? await buildExcel(ctx) : await buildZip(ctx);
  const name = kind === "excel" ? `nuzul-data-${stamp}.xlsx` : `nuzul-documents-${stamp}.zip`;
  const path = `${ctx.tenantId}/${crypto.randomUUID()}/${name}`;
  const contentType = kind === "excel" ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "application/zip";
  const up = await ctx.supabase.storage.from("exports").upload(path, body, { contentType });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });
  const { data } = await ctx.supabase.storage.from("exports").createSignedUrl(path, 3600, { download: name });
  if (!data?.signedUrl) return NextResponse.json({ error: "export failed" }, { status: 500 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
