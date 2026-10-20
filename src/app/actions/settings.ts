"use server";

import { revalidatePath } from "next/cache";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import { toBaisa } from "@/lib/format";
import type { ActionResult } from "@/components/ActionForm";

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
    ...row,
  });
  if (error) return { error: errorMessage(t, error) };
  revalidatePath("/settings");
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
  "maintenance", "finance", "reports", "compliance", "settings", "audit",
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
