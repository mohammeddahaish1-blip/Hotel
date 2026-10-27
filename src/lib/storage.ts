import "server-only";
import type { Ctx } from "./auth";

/** Upload an optional photo/PDF from a form to a private bucket under <tenant>/<random>. */
export async function uploadTo(ctx: Ctx, bucket: string, file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return null;
  const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${ctx.tenantId}/${crypto.randomUUID()}.${ext}`;
  const up = await ctx.supabase.storage.from(bucket).upload(path, file, { contentType: file.type || "image/jpeg" });
  return up.error ? { error: up.error } : { path };
}

/** Short-lived links to private files (null entries are skipped). */
export async function signedUrls(ctx: Ctx, bucket: string, paths: (string | null | undefined)[], seconds = 600) {
  const list = [...new Set(paths.filter((p): p is string => !!p))];
  const out = new Map<string, string>();
  if (!list.length) return out;
  const { data } = await ctx.supabase.storage.from(bucket).createSignedUrls(list, seconds);
  (data ?? []).forEach((u, i) => u.signedUrl && out.set(list[i], u.signedUrl));
  return out;
}
