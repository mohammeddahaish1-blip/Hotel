"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { normalizePhone, parseBaisa, toBaisa } from "@/lib/format";
import { hasRole } from "@/lib/auth";
import type { ActionResult } from "@/components/ActionForm";
import { moneyError } from "@/lib/money";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

async function run(fn: (ctx: Awaited<ReturnType<typeof getCtx>>) => PromiseLike<{ error: unknown }>): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const { error } = await fn(ctx);
  if (error) return { error: errorMessage(t, error as { message: string }) };
  revalidatePath("/settings");
  return { ok: t.saved };
}

export async function updateProperty(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase
      .from("properties")
      .update({
        name_ar: s(fd, "name_ar") ?? c.property.name_ar,
        name_en: s(fd, "name_en"),
        address: s(fd, "address"),
        phone: s(fd, "phone"),
        whatsapp: s(fd, "whatsapp"),
        email: s(fd, "email"),
        license_no: s(fd, "license_no"),
        vat_no: s(fd, "vat_no"),
        municipality: s(fd, "municipality") ?? "muscat",
        doc_retention_days: Number(s(fd, "doc_retention_days") ?? 365),
        bank_name: s(fd, "bank_name"),
        bank_account_name: s(fd, "bank_account_name"),
        bank_iban: s(fd, "bank_iban")?.replace(/\s/g, "").toUpperCase() ?? null,
        payment_instructions: s(fd, "payment_instructions"),
      })
      .eq("id", c.property.id),
  );
}

export async function updateTenantPolicy(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase.from("tenants").update({ max_reception_discount_bp: Math.round(Number(s(fd, "discount_pct") ?? 10) * 100) }).eq("id", c.tenantId),
  );
}

export async function addUnitType(_: ActionResult, fd: FormData) {
  const badMoney = await moneyError(fd, { nightly: "pos", monthly: "min0" });
  if (badMoney) return badMoney;
  return run((c) =>
    c.supabase.from("unit_types").insert({
      tenant_id: c.tenantId,
      property_id: c.property.id,
      name_ar: s(fd, "name_ar") ?? "",
      name_en: s(fd, "name_en"),
      kind: s(fd, "kind") ?? "room",
      capacity: Number(s(fd, "capacity") ?? 2),
      nightly_rate: toBaisa(s(fd, "nightly")),
      monthly_rate: toBaisa(s(fd, "monthly")),
    }),
  );
}

export async function updateUnitType(_: ActionResult, fd: FormData) {
  const badMoney = await moneyError(fd, { nightly: "pos", monthly: "min0" });
  if (badMoney) return badMoney;
  return run((c) =>
    c.supabase
      .from("unit_types")
      .update({ nightly_rate: toBaisa(s(fd, "nightly")), monthly_rate: toBaisa(s(fd, "monthly")), capacity: Number(s(fd, "capacity") ?? 2) })
      .eq("id", s(fd, "id")!),
  );
}

export async function addFloor(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase.from("floors").insert({ tenant_id: c.tenantId, property_id: c.property.id, name: s(fd, "name") ?? "", sort: Number(s(fd, "sort") ?? 0) }),
  );
}

export async function bulkUnits(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase.rpc("bulk_create_units", {
      p_property: c.property.id,
      p_unit_type: s(fd, "unit_type")!,
      p_floor: s(fd, "floor"),
      p_spec: s(fd, "spec") ?? "",
    }),
  );
}

export async function setUnitService(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase.from("units").update({ status: fd.get("out") === "1" ? "out_of_service" : "available" }).eq("id", s(fd, "id")!),
  );
}

export async function addRatePlan(_: ActionResult, fd: FormData) {
  const badMoney = await moneyError(fd, { nightly: "posOpt", monthly: "posOpt" });
  if (badMoney) return badMoney;
  return run((c) =>
    c.supabase.from("rate_plans").insert({
      tenant_id: c.tenantId,
      unit_type_id: s(fd, "unit_type")!,
      name: s(fd, "name") ?? "",
      period: `[${s(fd, "from")},${s(fd, "to")}]`,
      nightly_rate: s(fd, "nightly") ? toBaisa(s(fd, "nightly")) : null,
      monthly_rate: s(fd, "monthly") ? toBaisa(s(fd, "monthly")) : null,
      priority: 10,
    }),
  );
}

export async function deleteRatePlan(_: ActionResult, fd: FormData) {
  return run((c) => c.supabase.from("rate_plans").delete().eq("id", s(fd, "id")!));
}

export async function updateTax(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase
      .from("tax_rules")
      .update({
        rate_bp: Math.round(Number(s(fd, "rate") ?? 0) * 100),
        basis: s(fd, "basis") ?? "base",
        active: fd.get("active") === "on",
      })
      .eq("id", s(fd, "id")!),
  );
}

/** Internal role used for an owner-defined employee: the most senior section they were given. */
function baseRoleFor(areas: string[]): "manager" | "accountant" | "reception" | "housekeeping" | "maintenance" {
  if (areas.includes("settings")) return "manager";
  if (["finance", "reports", "audit", "dashboard"].some((a) => areas.includes(a))) return "accountant";
  if (["reservations", "guests", "calendar", "compliance"].some((a) => areas.includes(a))) return "reception";
  if (areas.includes("housekeeping")) return "housekeeping";
  return "maintenance";
}

export async function inviteUser(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const badMoney = await moneyError(fd, { salary: "min0" });
  if (badMoney) return badMoney;
  const ctx = await getCtx();
  const { t } = await getDict();
  const jobTitle = s(fd, "job_title");
  let row: Record<string, unknown>;
  if (ctx.role === "owner") {
    // Owner: free-text job title + the exact sections ticked in the form
    const areas = fd.getAll("areas").map(String).filter((a) => VALID_AREAS.has(a));
    if (areas.length === 0) return { error: t.invite_pick_sections };
    row = { role: baseRoleFor(areas), permissions: areas };
  } else {
    row = { role: s(fd, "role") ?? "reception" };
  }
  const { error } = await ctx.supabase.from("invitations").insert({
    tenant_id: ctx.tenantId,
    email: (s(fd, "email") ?? "").toLowerCase(),
    full_name: s(fd, "full_name") ?? "",
    job_title: jobTitle,
    ...staffDetails(fd),
    ...row,
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/settings");
  return { ok: t.saved };
}

/** Phone, civil ID, monthly salary (baisa) and work card; kept outside memberships, which every colleague can read. */
function staffDetails(fd: FormData) {
  const salary = s(fd, "salary");
  const expiry = s(fd, "work_card_expiry");
  return {
    phone: s(fd, "phone")?.slice(0, 30) ?? null,
    civil_id: s(fd, "civil_id")?.replace(/\s/g, "").slice(0, 20) ?? null,
    salary: salary ? toBaisa(salary) : null,
    work_card_no: s(fd, "work_card_no")?.slice(0, 30) ?? null,
    work_card_expiry: expiry && /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : null,
  };
}

export async function updateStaffProfile(_: ActionResult, fd: FormData) {
  const badMoney = await moneyError(fd, { salary: "min0" });
  if (badMoney) return badMoney;
  const userId = s(fd, "user_id")!;
  const res = await run((c) =>
    c.supabase.from("staff_profiles").upsert({ tenant_id: c.tenantId, user_id: userId, ...staffDetails(fd) }),
  );
  revalidatePath(`/profile/${userId}`);
  return res;
}

/** Profile page: one field edited in place. Only that column is written, so other details stay as they are. */
export async function updateProfileField(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const userId = s(fd, "user_id") ?? "";
  const field = s(fd, "field") ?? "";
  const raw = s(fd, "value");
  if (!/^[0-9a-f-]{36}$/.test(userId) || !hasRole(ctx, ["manager"])) return { error: t.err_FORBIDDEN };
  // same rule as the profile page: nobody but the owner edits the owner's details
  const { data: target } = await ctx.supabase.from("memberships").select("role").eq("tenant_id", ctx.tenantId).eq("user_id", userId).maybeSingle();
  if (!target || (target.role === "owner" && userId !== ctx.userId)) return { error: t.err_FORBIDDEN };
  let patch: Record<string, string | number | null>;
  let table: "staff_profiles" | "memberships" = "staff_profiles";
  switch (field) {
    case "phone": {
      const p = normalizePhone(raw);
      if (p === null) return { error: t.err_INVALID_PHONE };
      patch = { phone: p || null };
      break;
    }
    case "civil_id":
      patch = { civil_id: raw?.replace(/\s/g, "").slice(0, 20) ?? null };
      break;
    case "salary": {
      const bad = await moneyError(fd, { value: "min0" });
      if (bad) return bad;
      patch = { salary: raw ? parseBaisa(raw) : null };
      break;
    }
    case "work_card_no":
      patch = { work_card_no: raw?.slice(0, 30) ?? null };
      break;
    case "work_card_expiry":
      if (raw && !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return { error: t.err_invalid_value };
      patch = { work_card_expiry: raw };
      break;
    case "full_name":
      if (!raw) return { error: t.err_GUEST_NAME_REQUIRED };
      table = "memberships";
      patch = { full_name: raw.slice(0, 120) };
      break;
    case "job_title":
      table = "memberships";
      patch = { job_title: raw?.slice(0, 60) ?? null };
      break;
    default:
      return { error: t.err_invalid_value };
  }
  const { error } = table === "memberships"
    ? await ctx.supabase.from("memberships").update(patch).eq("tenant_id", ctx.tenantId).eq("user_id", userId)
    : await ctx.supabase.from("staff_profiles").upsert({ tenant_id: ctx.tenantId, user_id: userId, ...patch });
  if (error) return { error: errorMessage(t, error) };
  ["/profile", `/profile/${userId}`, "/settings"].forEach((x) => revalidatePath(x));
  if (table === "memberships") revalidatePath("/", "layout");
  return { ok: t.saved };
}

export async function updateMember(_: ActionResult, fd: FormData) {
  const role = s(fd, "role");
  return run((c) =>
    c.supabase
      .from("memberships")
      .update({ job_title: s(fd, "job_title"), active: fd.get("active") === "on", ...(role ? { role } : {}) })
      .eq("tenant_id", c.tenantId)
      .eq("user_id", s(fd, "user_id")!),
  );
}

const VALID_AREAS = new Set([
  "dashboard", "board", "calendar", "reservations", "guests", "housekeeping",
  "maintenance", "finance", "reports", "compliance", "settings", "audit", "feedback", "import",
]);

/** Owner grants/revokes sections for one employee (null = role defaults). */
export async function setPermissions(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  if (ctx.role !== "owner") return { error: t.perm_owner_only };
  const areas = fd.getAll("areas").map(String).filter((a) => VALID_AREAS.has(a));
  const permissions = fd.get("use_defaults") === "on" ? null : areas;
  const { data, error } = await ctx.supabase
    .from("memberships")
    .update({ permissions })
    .eq("tenant_id", ctx.tenantId)
    .eq("user_id", s(fd, "user_id")!)
    .neq("role", "owner")
    .select("user_id");
  if (error) return { error: errorMessage(t, error) };
  if (!data?.length) return { error: t.err_FORBIDDEN };
  revalidatePath("/settings/permissions");
  return { ok: t.saved };
}

// ---------------------------------------------------------------- edit / cancel setup data
export async function updateFloor(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase.from("floors").update({ name: s(fd, "name") ?? "", sort: Number(s(fd, "sort") ?? 0) }).eq("id", s(fd, "id")!),
  );
}

/** Only an empty floor can be removed. */
export async function deleteFloor(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = s(fd, "id")!;
  const { count } = await ctx.supabase.from("units").select("id", { count: "exact", head: true }).eq("floor_id", id);
  if (count) return { error: t.floor_has_units };
  const { error } = await ctx.supabase.from("floors").delete().eq("id", id);
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/settings");
  return { ok: t.saved };
}

export async function updateUnit(_: ActionResult, fd: FormData) {
  return run((c) =>
    c.supabase
      .from("units")
      .update({ number: s(fd, "number") ?? "", unit_type_id: s(fd, "unit_type")!, floor_id: s(fd, "floor") })
      .eq("id", s(fd, "id")!),
  );
}

/** Stop selling a unit (kept with its history), or bring it back. */
export async function setUnitActive(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = s(fd, "id")!;
  const active = s(fd, "active") === "1";
  if (!active) {
    const { count } = await ctx.supabase
      .from("reservations").select("id", { count: "exact", head: true })
      .eq("unit_id", id).in("status", ["tentative", "confirmed", "checked_in"]);
    if (count) return { error: t.unit_has_bookings };
  }
  const { error } = await ctx.supabase.from("units").update({ active }).eq("id", id);
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/settings");
  return { ok: t.saved };
}

export async function updateRatePlan(_: ActionResult, fd: FormData) {
  const badMoney = await moneyError(fd, { nightly: "posOpt", monthly: "posOpt" });
  if (badMoney) return badMoney;
  const nightly = s(fd, "nightly");
  const monthly = s(fd, "monthly");
  return run((c) =>
    c.supabase
      .from("rate_plans")
      .update({
        name: s(fd, "name") ?? "",
        period: `[${s(fd, "from")},${s(fd, "to")}]`,
        nightly_rate: nightly ? toBaisa(nightly) : null,
        monthly_rate: monthly ? toBaisa(monthly) : null,
      })
      .eq("id", s(fd, "id")!),
  );
}

/** Withdraw an invitation that was not accepted yet. */
export async function cancelInvite(_: ActionResult, fd: FormData) {
  return run((c) => c.supabase.from("invitations").delete().eq("id", s(fd, "id")!).is("accepted_at", null));
}

// ---------------------------------------------------------------- unit types & units: rename / delete / bulk add
const KINDS = ["room", "suite", "studio", "apartment"];

export async function renameUnitType(_: ActionResult, fd: FormData) {
  const kind = s(fd, "kind") ?? "room";
  return run((c) =>
    c.supabase
      .from("unit_types")
      .update({ name_ar: s(fd, "name_ar") ?? "", name_en: s(fd, "name_en"), kind: KINDS.includes(kind) ? kind : "room" })
      .eq("id", s(fd, "id")!),
  );
}

/** Only a type no unit uses can be removed (its seasonal prices go with it). */
export async function deleteUnitType(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = s(fd, "id")!;
  const { count } = await ctx.supabase.from("units").select("id", { count: "exact", head: true }).eq("unit_type_id", id);
  if (count) return { error: t.type_has_units.replace("{n}", String(count)) };
  const { error } = await ctx.supabase.from("unit_types").delete().eq("id", id);
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/settings");
  return { ok: t.deleted };
}

/** A unit added by mistake (never booked, no expenses) can be removed; otherwise it is deactivated to keep its history. */
export async function deleteUnit(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const id = s(fd, "id")!;
  const [{ count: res }, { count: exp }] = await Promise.all([
    ctx.supabase.from("reservations").select("id", { count: "exact", head: true }).eq("unit_id", id),
    ctx.supabase.from("expenses").select("id", { count: "exact", head: true }).eq("unit_id", id),
  ]);
  if (res || exp) return { error: t.unit_used_deactivate };
  const { error } = await ctx.supabase.from("units").delete().eq("id", id);
  if (error) return { error: (error as { code?: string }).code === "23503" ? t.unit_used_deactivate : errorMessage(t, error) };
  revalidatePath("/settings");
  revalidatePath("/board");
  return { ok: t.deleted };
}

/** Bulk add from the list the form previewed; numbers that already exist are skipped. */
export async function bulkAddUnits(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  const numbers = (s(fd, "numbers") ?? "").split(",").map((x) => x.trim()).filter((x) => /^[\p{L}\p{N}-]{1,20}$/u.test(x));
  if (numbers.length === 0) return { error: t.bulk_none };
  if (numbers.length > 500) return { error: t.bulk_too_many };
  const { data, error } = await ctx.supabase.rpc("bulk_create_units", {
    p_property: ctx.property.id, p_unit_type: s(fd, "unit_type")!, p_floor: s(fd, "floor"), p_spec: numbers.join(","),
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/settings");
  revalidatePath("/board");
  const added = Number(data ?? 0);
  // numbers already in use were dropped in the browser; the RPC also skips any taken in the meantime
  const preSkipped = Math.min(Math.max(Math.floor(Number(s(fd, "skipped")) || 0), 0), 500);
  return { ok: t.bulk_done.replace("{n}", String(added)).replace("{skipped}", String(numbers.length - added + preSkipped)) };
}
