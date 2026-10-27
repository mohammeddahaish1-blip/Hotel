import { NextResponse, type NextRequest } from "next/server";
import { getCtx, can, hasRole } from "@/lib/auth";
import { csv, plainOmr } from "@/lib/format";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** CSV exports (open directly in Excel). Compliance exports are logged (CR-01, CR-02). */
export async function GET(req: NextRequest) {
  const ctx = await getCtx();
  const sp = req.nextUrl.searchParams;
  const kind = sp.get("kind");
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to)) return NextResponse.json({ error: "bad dates" }, { status: 400 });
  const db = ctx.supabase;
  const p = ctx.property.id;
  let body = "";
  let name = `${kind}-${from}-${to}.csv`;

  if (kind === "police") {
    if (!can(ctx, "compliance")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data, error } = await db.rpc("police_register", { p_property: p, p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const rows = (data ?? []) as Record<string, unknown>[];
    // doc_source: reader (ID card reader) / camera (photo) / manual (typed)
    const codes = rows.map((r) => String(r.reservation_code));
    const { data: src } = codes.length
      ? await db.from("reservations").select("code, guests(doc_source)").eq("property_id", p).in("code", codes)
      : { data: [] };
    const sourceOf = new Map((src ?? []).map((x) => [x.code as string, (x.guests as unknown as { doc_source: string | null } | null)?.doc_source ?? ""]));
    for (const r of rows) r.doc_source = sourceOf.get(String(r.reservation_code)) ?? "";
    body = csv(rows, [
      "reservation_code", "guest_name", "guest_name_ar", "nationality", "doc_type", "doc_number", "doc_expiry",
      "date_of_birth", "gender", "phone", "unit", "check_in", "expected_checkout", "check_out", "adults", "children", "doc_source",
    ]);
    await db.from("compliance_submissions").insert({
      tenant_id: ctx.tenantId, property_id: p, authority: "rop", kind: "guest_register",
      period: `[${from},${to}]`, record_count: rows.length,
    });
    name = `ROP-guest-register-${from}-${to}.csv`;
  } else if (kind === "ministry") {
    if (!can(ctx, "compliance")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data, error } = await db.rpc("ministry_statistics", { p_property: p, p_from: from, p_to: to });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const st = data as { by_nationality: { nationality: string; guests: number; nights: number }[]; occupancy: Record<string, number>; invoiced_revenue: number; employees: number };
    body = csv([
      ...st.by_nationality.map((n) => ({ metric: "nationality", key: n.nationality, guests: n.guests, nights: n.nights, value: "" })),
      { metric: "room_nights_sold", key: "", guests: "", nights: "", value: st.occupancy.room_nights_sold },
      { metric: "room_nights_available", key: "", guests: "", nights: "", value: st.occupancy.room_nights_available },
      { metric: "room_revenue_omr", key: "", guests: "", nights: "", value: plainOmr(st.occupancy.room_revenue) },
      { metric: "invoiced_revenue_omr", key: "", guests: "", nights: "", value: plainOmr(st.invoiced_revenue) },
      { metric: "employees", key: "", guests: "", nights: "", value: st.employees },
    ] as Record<string, unknown>[]);
    await db.from("compliance_submissions").insert({
      tenant_id: ctx.tenantId, property_id: p, authority: "mht", kind: "statistics",
      period: `[${from},${to}]`, record_count: st.by_nationality.length, payload: st,
    });
    name = `MHT-statistics-${from}-${to}.csv`;
  } else if (kind === "occupancy") {
    if (!can(ctx, "reports")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data } = await db.rpc("occupancy_report", { p_property: p, p_from: from, p_to: to });
    body = csv(
      ((data ?? []) as Record<string, number | string>[]).map((r) => ({
        day: r.day, units: r.units, sold: r.sold, occupancy_pct: (Number(r.occupancy_bp) / 100).toFixed(1),
        room_revenue_omr: plainOmr(r.room_revenue), adr_omr: plainOmr(r.adr), revpar_omr: plainOmr(r.revpar),
      })),
    );
  } else if (kind === "accounting") {
    // FR-37 (first step): monthly invoice ledger for the accountant
    if (!can(ctx, "reports")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data } = await db.from("invoices").select("series, number, issued_at, subtotal, tax_total, total, snapshot").eq("property_id", p)
      .gte("issued_at", `${from}T00:00:00`).lte("issued_at", `${to}T23:59:59`).order("number");
    body = csv(
      (data ?? []).map((i) => {
        const taxes = Object.fromEntries(((i.snapshot as { tax_lines: { code: string; amount: number }[] }).tax_lines ?? []).map((x) => [`${x.code}_omr`, plainOmr(x.amount)]));
        return { invoice: `${i.series}-${i.number}`, issued_at: i.issued_at, buyer: (i.snapshot as { buyer: { name: string } }).buyer?.name, subtotal_omr: plainOmr(i.subtotal), ...taxes, tax_total_omr: plainOmr(i.tax_total), total_omr: plainOmr(i.total) };
      }),
      ["invoice", "issued_at", "buyer", "subtotal_omr", "service_omr", "tourism_omr", "municipality_omr", "vat_omr", "tax_total_omr", "total_omr"],
    );
  } else if (kind === "expenses") {
    if (!hasRole(ctx, ["manager", "accountant"])) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const { data } = await db.from("expenses").select("expense_date, category, description, method, amount, created_by, attachment_path")
      .eq("property_id", p).is("archived_at", null).gte("expense_date", from).lte("expense_date", to).order("expense_date");
    const { data: staff } = await db.from("memberships").select("user_id, full_name").eq("tenant_id", ctx.tenantId);
    const who = new Map((staff ?? []).map((m) => [m.user_id, m.full_name]));
    body = csv(
      (data ?? []).map((e) => ({
        date: e.expense_date, category: e.category, description: e.description, method: e.method,
        amount_omr: plainOmr(e.amount), added_by: who.get(e.created_by) ?? "", receipt: e.attachment_path ? "yes" : "",
      })),
      ["date", "category", "description", "method", "amount_omr", "added_by", "receipt"],
    );
    name = `expenses-${from}-${to}.csv`;
  } else {
    return NextResponse.json({ error: "unknown kind" }, { status: 400 });
  }

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
