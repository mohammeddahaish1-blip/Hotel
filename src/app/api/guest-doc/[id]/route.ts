import { NextResponse, type NextRequest } from "next/server";
import { can, getCtx } from "@/lib/auth";

/** Opens a guest ID image: the opening is logged with who and when, then a 60-second link is issued. */
export async function GET(_: NextRequest, { params }: RouteContext<"/api/guest-doc/[id]">) {
  const ctx = await getCtx();
  if (!can(ctx, "guests")) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  const { data: doc } = await ctx.supabase.from("guest_documents").select("id, guest_id, storage_path").eq("id", id).maybeSingle();
  if (!doc) return NextResponse.json({ error: "not found" }, { status: 404 });
  // No log entry, no image
  const { error } = await ctx.supabase.from("document_access_log").insert({ tenant_id: ctx.tenantId, guest_document_id: doc.id, guest_id: doc.guest_id, viewed_by: ctx.userId });
  if (error) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { data } = await ctx.supabase.storage.from("guest-docs").createSignedUrl(doc.storage_path, 60);
  if (!data?.signedUrl) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { headers: { "Cache-Control": "no-store" } });
}
