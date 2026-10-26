"use server";

import { revalidatePath } from "next/cache";
import { can, getCtx, type Ctx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { todayIn } from "@/lib/format";
import { counts, detect, IMPORT_TYPES, validate, type ImportRow, type ImportSheet, type ImportType, type Lookups } from "@/lib/import/detect";
import { kindOf, readFile } from "@/lib/import/read";
import { importLabels } from "@/lib/import/labels";

type Payload = { sheets: ImportSheet[] };

async function lookups(ctx: Ctx): Promise<Lookups> {
  const db = ctx.supabase;
  const [{ data: unitTypes }, { data: floors }, { data: units }, { data: guests }] = await Promise.all([
    db.from("unit_types").select("id, name_ar, name_en").eq("property_id", ctx.property.id),
    db.from("floors").select("id, name").eq("property_id", ctx.property.id),
    db.from("units").select("id, number").eq("property_id", ctx.property.id),
    db.from("guests").select("id, full_name, phone, doc_number").eq("tenant_id", ctx.tenantId).limit(20000),
  ]);
  return {
    today: todayIn(ctx.property.timezone),
    unitTypes: unitTypes ?? [],
    floors: floors ?? [],
    units: units ?? [],
    guests: guests ?? [],
  };
}

function totals(sheets: ImportSheet[]) {
  const all = sheets.flatMap((s) => s.rows);
  return counts(all);
}

/** Read one uploaded file, recognise each sheet and validate every row. Saves only the job (the preview). */
export async function analyzeImport(fd: FormData): Promise<{ id?: string; error?: string }> {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const L = importLabels[lang];
  if (!can(ctx, "import")) return { error: t.err_FORBIDDEN };
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: L.errEmpty };
  const kind = kindOf(file.name);
  if (!kind) return { error: L.errType };
  let raws;
  try {
    raws = await readFile(kind, Buffer.from(await file.arrayBuffer()));
  } catch {
    return { error: L.errRead };
  }
  if (!raws.length) return { error: kind === "pdf" ? L.errPdfText : L.errEmpty };
  const lk = await lookups(ctx);
  const sheets: ImportSheet[] = raws.map(({ name, raw }) => {
    const d = detect(raw);
    return {
      name, raw, type: d.type, headerRow: d.headerRow, header: raw[d.headerRow] ?? [], mapping: d.mapping,
      rows: d.type ? validate(raw, d.type, d.headerRow, d.mapping, lk) : [],
    };
  });
  const c = totals(sheets);
  const { data, error } = await ctx.supabase
    .from("import_jobs")
    .insert({
      tenant_id: ctx.tenantId, property_id: ctx.property.id, file_name: file.name.slice(0, 255), file_kind: kind,
      sheets: sheets.length, ...c, payload: { sheets } satisfies Payload,
    })
    .select("id")
    .single();
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/import");
  return { id: data.id };
}

async function loadJob(ctx: Ctx, id: string) {
  const { data } = await ctx.supabase.from("import_jobs").select("*").eq("id", id).single();
  return data as (Record<string, unknown> & { id: string; status: string; payload: Payload }) | null;
}

/** The user corrects what a sheet contains (or ignores it); rows are re-checked. */
export async function setSheetType(fd: FormData) {
  const ctx = await getCtx();
  const id = String(fd.get("id"));
  const idx = Number(fd.get("sheet"));
  const v = String(fd.get("type") ?? "");
  const type = (IMPORT_TYPES as readonly string[]).includes(v) ? (v as ImportType) : null;
  const job = await loadJob(ctx, id);
  if (!job || job.status !== "validated" || !job.payload.sheets[idx]) return;
  const sheet = job.payload.sheets[idx];
  if (type) {
    const d = detect(sheet.raw, type);
    Object.assign(sheet, { type, headerRow: d.headerRow, header: sheet.raw[d.headerRow] ?? [], mapping: d.mapping });
    sheet.rows = validate(sheet.raw, type, d.headerRow, d.mapping, await lookups(ctx));
  } else {
    Object.assign(sheet, { type: null, rows: [] });
  }
  await ctx.supabase.from("import_jobs").update({ payload: job.payload, ...totals(job.payload.sheets) }).eq("id", id);
  revalidatePath(`/import/${id}`);
}

export async function cancelImport(fd: FormData) {
  const ctx = await getCtx();
  const id = String(fd.get("id"));
  await ctx.supabase.from("import_jobs").update({ status: "cancelled" }).eq("id", id).eq("status", "validated");
  revalidatePath("/import");
  revalidatePath(`/import/${id}`);
}

const savable = (r: ImportRow) => r.status === "ok" || r.status === "warn";

/** Write the ready rows (and rows with notes) to the real tables; record the outcome of every row. */
export async function commitImport(fd: FormData) {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = String(fd.get("id"));
  const job = await loadJob(ctx, id);
  if (!job || job.status !== "validated") return;
  // claim the job first so a double click can't import twice
  const { data: claimed } = await ctx.supabase.from("import_jobs").update({ status: "partial" }).eq("id", id).eq("status", "validated").select("id");
  if (!claimed?.length) return;
  const db = ctx.supabase;
  const fail = (r: ImportRow, e: { message?: string } | string) => { r.result = "failed"; r.error = errorMessage(t, e); };
  // One insert for the whole batch; if anything is rejected, retry row by row to know which ones
  const insertAll = async (rows: ImportRow[], toRecord: (r: ImportRow) => Record<string, unknown>, table: "units" | "guests" | "expenses") => {
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await db.from(table).insert(chunk.map(toRecord) as never);
      if (!error) { chunk.forEach((r) => (r.result = "saved")); continue; }
      for (const r of chunk) {
        const { error: e } = await db.from(table).insert(toRecord(r) as never);
        if (e) fail(r, e); else r.result = "saved";
      }
    }
  };

  for (const sheet of job.payload.sheets) {
    const rows = sheet.rows.filter(savable);
    if (!sheet.type || !rows.length) continue;

    if (sheet.type === "units") {
      const typeIds = new Map<string, string>();
      const floorIds = new Map<string, string>();
      for (const r of rows) {
        const nt = r.data.new_type as string | undefined;
        if (nt && !typeIds.has(nt)) {
          const { data, error } = await db.from("unit_types")
            .insert({ tenant_id: ctx.tenantId, property_id: ctx.property.id, name_ar: nt, kind: "room", capacity: 2, nightly_rate: Number(r.data.rate ?? 0) })
            .select("id").single();
          if (error) { fail(r, error); continue; }
          typeIds.set(nt, data.id);
        }
        const nf = r.data.new_floor as string | undefined;
        if (nf && !floorIds.has(nf)) {
          const { data, error } = await db.from("floors").insert({ tenant_id: ctx.tenantId, property_id: ctx.property.id, name: nf, sort: 0 }).select("id").single();
          if (!error) floorIds.set(nf, data.id);
        }
      }
      const ok = rows.filter((r) => r.result !== "failed");
      await insertAll(ok, (r) => ({
        tenant_id: ctx.tenantId, property_id: ctx.property.id, number: String(r.data.number),
        unit_type_id: (r.data.unit_type_id as string) ?? typeIds.get(r.data.new_type as string),
        floor_id: (r.data.floor_id as string) ?? (r.data.new_floor ? floorIds.get(r.data.new_floor as string) ?? null : null),
      }), "units");
    }

    if (sheet.type === "guests") {
      await insertAll(rows, (r) => ({
        tenant_id: ctx.tenantId, full_name: String(r.data.full_name), phone: r.data.phone as string | null,
        doc_type: (r.data.doc_type as never) ?? null, doc_number: r.data.doc_number as string | null,
        doc_expiry: r.data.doc_expiry as string | null, nationality: r.data.nationality as string | null,
        email: r.data.email as string | null,
        // the hotel confirms it holds consent for the records it imports (shown on the import page)
        consent_at: new Date().toISOString(), consent_version: "import",
      }), "guests");
    }

    if (sheet.type === "expenses") {
      await insertAll(rows, (r) => ({
        tenant_id: ctx.tenantId, property_id: ctx.property.id, category: String(r.data.category),
        description: String(r.data.description), amount: Number(r.data.amount), expense_date: String(r.data.expense_date),
        method: String(r.data.method),
      }), "expenses");
    }

    if (sheet.type === "reservations") {
      const created = new Map<string, string>();
      for (const r of rows) {
        let guest = (r.data.guest_id as string | undefined) ?? created.get(String(r.data.phone ?? r.data.guest_name));
        if (!guest) {
          const { data, error } = await db.from("guests")
            .insert({ tenant_id: ctx.tenantId, full_name: String(r.data.guest_name), phone: r.data.phone as string | null, consent_at: new Date().toISOString(), consent_version: "import" })
            .select("id").single();
          if (error) { fail(r, error); continue; }
          guest = data.id as string;
          created.set(String(r.data.phone ?? r.data.guest_name), guest);
        }
        const { error } = await db.rpc("create_reservation", {
          p_property: ctx.property.id, p_unit: String(r.data.unit_id), p_guest: guest,
          p_from: String(r.data.from), p_to: String(r.data.to), p_source: r.data.source as never, p_adults: Number(r.data.adults ?? 1),
        });
        if (error) fail(r, error); else r.result = "saved";
      }
    }
  }

  const all = job.payload.sheets.flatMap((s) => s.rows);
  const saved = all.filter((r) => r.result === "saved").length;
  const failed = all.filter((r) => r.result === "failed").length;
  await db.from("import_jobs")
    .update({ payload: job.payload, saved, failed, status: failed ? "partial" : "saved", saved_at: new Date().toISOString() })
    .eq("id", id);
  ["/import", `/import/${id}`, "/finance", "/guests", "/reservations", "/board", "/calendar", "/settings", "/dashboard"].forEach((p) => revalidatePath(p));
}
