import "server-only";
import type { Ctx } from "./auth";
import { omr } from "./format";
import { appUrl } from "./feedback-qr";
import type { PayLink } from "@/components/PaymentLinksList";

type Row = Omit<PayLink, "url" | "message" | "proofUrl" | "guest" | "phone" | "code" | "unit"> & {
  reservations: { code: string; units: { number: string } | null; guests: { full_name: string; phone: string | null; preferred_language: string } | null } | null;
};

/** Payment links with their public URL, a ready WhatsApp text and a short-lived link to the uploaded proof. */
export async function loadPaymentLinks(ctx: Ctx, opts: { reservation?: string; statuses?: string[] }): Promise<PayLink[]> {
  let q = ctx.supabase
    .from("payment_links")
    .select("id, token, amount, purpose, status, created_at, expires_at, proof_path, payer_note, reservation_id, reservations(code, units(number), guests(full_name, phone, preferred_language))")
    .eq("property_id", ctx.property.id)
    .order("created_at", { ascending: false })
    .limit(100);
  if (opts.reservation) q = q.eq("reservation_id", opts.reservation);
  if (opts.statuses) q = q.in("status", opts.statuses);
  const { data } = await q;
  const rows = (data ?? []) as unknown as Row[];
  const proofs = rows.map((r) => r.proof_path).filter(Boolean) as string[];
  const signed = proofs.length ? (await ctx.supabase.storage.from("link-proofs").createSignedUrls(proofs, 300)).data ?? [] : [];
  const proofUrl = new Map(signed.map((s) => [s.path, s.signedUrl]));
  const hotel = ctx.property.name_ar;
  return Promise.all(
    rows.map(async (r) => {
      const url = await appUrl(`/p/${r.token}`);
      const g = r.reservations?.guests;
      const en = g?.preferred_language === "en";
      const name = g?.full_name?.split(" ")[0] ?? "";
      const message = en
        ? `Hello ${name}, here is your payment link for booking ${r.reservations?.code} at ${ctx.property.name_en ?? hotel}: ${omr(r.amount, "en")}\n${url}`
        : `مرحباً ${name}، رابط الدفع لحجزكم ${r.reservations?.code} في ${hotel}: ${omr(r.amount, "ar")}\n${url}`;
      return {
        ...r, url, message, proofUrl: r.proof_path ? proofUrl.get(r.proof_path) ?? null : null,
        guest: g?.full_name ?? null, phone: g?.phone ?? null, code: r.reservations?.code ?? null, unit: r.reservations?.units?.number ?? null,
      };
    }),
  );
}
