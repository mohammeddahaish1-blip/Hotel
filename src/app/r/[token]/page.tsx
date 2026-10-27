import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { dictionaries, type DictKey } from "@/lib/i18n/dict";
import { dateTime, omr } from "@/lib/format";
import { PrintButton } from "@/components/PrintButton";

export const metadata: Metadata = { title: "سند قبض — Receipt", robots: { index: false } };

type Receipt = {
  receipt_no: number; amount: number; kind: string; method: string; reference: string | null; received_at: string; voided: boolean;
  property: string; property_en: string | null; phone: string | null; address: string | null; vat_no: string | null; timezone: string;
  guest: string | null; code: string | null; unit: string | null; staff: string | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public, bilingual receipt voucher opened from the WhatsApp link (no login).
export default async function ReceiptPage({ params }: PageProps<"/r/[token]">) {
  const { token } = await params;
  let r: Receipt | null = null;
  if (UUID.test(token)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("receipt_public", { p_token: token });
    r = (data as Receipt | null) ?? null;
  }
  const ar = dictionaries.ar;
  const en = dictionaries.en;
  const both = (k: DictKey) => `${ar[k]} / ${en[k]}`;

  return (
    <div className="min-h-screen bg-bg px-4 py-8" dir="rtl">
      <div className="mx-auto max-w-lg">
        {!r ? (
          <div className="card p-6 text-center text-muted">{ar.rc_not_found} / {en.rc_not_found}</div>
        ) : (
          <>
            <article className={`card relative overflow-hidden p-6 ${r.voided ? "opacity-60" : ""}`}>
              {r.voided ? (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-6xl font-black text-danger/30 -rotate-12">{ar.rc_voided} · {en.rc_voided}</div>
              ) : null}
              <header className="flex items-start justify-between gap-3 border-b border-line pb-4">
                <div>
                  <div className="text-lg font-bold">{r.property}</div>
                  {r.property_en ? <div className="text-sm text-muted" dir="ltr">{r.property_en}</div> : null}
                  <div className="mt-1 text-xs text-muted">{[r.address, r.phone].filter(Boolean).join(" · ")}</div>
                  {r.vat_no ? <div className="text-xs text-muted">{both("vat_no")}: {r.vat_no}</div> : null}
                </div>
                <div className="text-end">
                  <div className="brand-word text-3xl text-brand">نُزُل</div>
                </div>
              </header>
              <div className="my-5 text-center">
                <div className="text-xl font-bold">{ar.rc_receipt} <span className="text-muted">/</span> <span dir="ltr">{en.rc_receipt}</span></div>
                <div className="num mt-1 text-sm text-muted">#{r.receipt_no} · {dateTime(r.received_at, r.timezone, "ar")}</div>
              </div>
              <dl className="space-y-3 text-sm">
                {[
                  [both("rc_received_from"), r.guest ?? "—"],
                  [both("rc_sum_of"), `${omr(r.amount, "ar")}  ·  ${omr(r.amount, "en")}`],
                  [both("method"), `${ar[`pm_${r.method}` as DictKey] ?? r.method} / ${en[`pm_${r.method}` as DictKey] ?? r.method}`],
                  r.kind !== "payment" ? [both("type"), `${ar[`pk_${r.kind}` as DictKey]} / ${en[`pk_${r.kind}` as DictKey]}`] : null,
                  r.code ? [both("rc_for"), `${r.code}${r.unit ? ` · ${ar.unit} ${r.unit}` : ""}`] : null,
                  r.reference ? [both("reference"), r.reference] : null,
                  r.staff ? [both("rc_by"), r.staff] : null,
                ]
                  .filter((x): x is [string, string] => !!x)
                  .map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-4 border-b border-dashed border-line pb-2">
                      <dt className="text-muted">{k}</dt>
                      <dd className="text-end font-semibold" dir="auto">{v}</dd>
                    </div>
                  ))}
              </dl>
            </article>
            <div className="no-print mt-4 text-center"><PrintButton label={`${ar.print} / ${en.print}`} /></div>
          </>
        )}
      </div>
    </div>
  );
}
