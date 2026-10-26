"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getCtx, hasRole, type Ctx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "@/components/ActionForm";

const s = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};
const KINDS = ["hotel", "apartments", "mixed"];

/** Stores an optional photo under <tenant>/<property>/ and links it to the property. */
async function attachPhoto(ctx: Ctx, propertyId: string, fd: FormData) {
  const file = fd.get("photo");
  if (!(file instanceof File) || file.size === 0) return null;
  if (!file.type.startsWith("image/")) return { message: "photo" };
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.tenantId}/${propertyId}/${crypto.randomUUID()}.${ext}`;
  const up = await ctx.supabase.storage.from("property-photos").upload(path, file, { contentType: file.type });
  if (up.error) return up.error;
  const { error } = await ctx.supabase.from("properties").update({ photo_path: path }).eq("id", propertyId);
  return error;
}

async function selectProperty(id: string) {
  (await cookies()).set("property", id, { path: "/", maxAge: 31536000, sameSite: "lax" });
}

/** Owner adds another hotel / building to the account. */
export async function createProperty(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  if (ctx.role !== "owner") return { error: t.prop_owner_only };
  const kind = s(fd, "kind") ?? "hotel";
  const { data, error } = await ctx.supabase
    .from("properties")
    .insert({
      tenant_id: ctx.tenantId,
      name_ar: s(fd, "name_ar") ?? "",
      name_en: s(fd, "name_en"),
      kind: KINDS.includes(kind) ? kind : "hotel",
      address: s(fd, "address"),
      phone: s(fd, "phone"),
    })
    .select("id")
    .single();
  if (error) return { error: errorMessage(t, error) };
  const upErr = await attachPhoto(ctx, data.id, fd);
  if (fd.get("make_current") === "on") await selectProperty(data.id);
  revalidatePath("/", "layout");
  if (upErr) return { error: errorMessage(t, upErr as { message: string }) };
  redirect(`/properties/${data.id}`);
}

/** Owner/manager edits a property's details and photo (any property of the account). */
export async function updatePropertyInfo(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  const { t } = await getDict();
  if (!hasRole(ctx, ["manager"])) return { error: t.err_FORBIDDEN };
  const id = s(fd, "id")!;
  const kind = s(fd, "kind") ?? "hotel";
  const { data, error } = await ctx.supabase
    .from("properties")
    .update({
      name_ar: s(fd, "name_ar") ?? undefined,
      name_en: s(fd, "name_en"),
      kind: KINDS.includes(kind) ? kind : "hotel",
      address: s(fd, "address"),
      phone: s(fd, "phone"),
      license_no: s(fd, "license_no"),
    })
    .eq("id", id)
    .eq("tenant_id", ctx.tenantId)
    .select("id");
  if (error) return { error: errorMessage(t, error) };
  if (!data?.length) return { error: t.err_FORBIDDEN };
  const upErr = await attachPhoto(ctx, id, fd);
  if (upErr) return { error: errorMessage(t, upErr as { message: string }) };
  revalidatePath("/properties");
  revalidatePath(`/properties/${id}`);
  return { ok: t.saved };
}

/** Work on another property (same as the switcher in the sidebar). */
export async function switchProperty(fd: FormData) {
  const ctx = await getCtx();
  const id = String(fd.get("id"));
  if (ctx.properties.some((p) => p.id === id)) await selectProperty(id);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
