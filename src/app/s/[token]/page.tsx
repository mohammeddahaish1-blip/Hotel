import type { Metadata } from "next";
import { CircleCheck, ShieldCheck, TriangleAlert } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { dictionaries } from "@/lib/i18n/dict";
import { dateTime } from "@/lib/format";
import { signContract } from "@/app/actions/contracts";
import { PrintButton } from "@/components/PrintButton";
import { SignaturePad } from "@/components/SignaturePad";

export const metadata: Metadata = { title: "توقيع العقد — Sign contract", robots: { index: false } };

type Doc = {
  title: string; body: string; hash: string; status: "awaiting_guest" | "signed" | "void"; intact: boolean;
  hotel_ar: string; hotel_en: string | null; lang: string; hotel_signer: string | null; hotel_signed_at: string | null;
  guest_sign_name: string | null; guest_signature: string | null; guest_signed_at: string | null; created_at: string; timezone: string;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public signing page: the contract text, both signatures, and the fingerprint that proves the text did not change.
export default async function SignPage({ params }: PageProps<"/s/[token]">) {
  const { token } = await params;
  let d: Doc | null = null;
  if (UUID.test(token)) {
    const { data } = await (await createClient()).rpc("contract_document_public", { p_token: token });
    d = (data as Doc | null) ?? null;
  }
  const lang = d?.lang === "en" ? "en" : "ar";
  const t = dictionaries[lang];

  return (
    <div className="min-h-screen bg-bg px-4 py-8" dir={lang === "en" ? "ltr" : "rtl"} lang={lang}>
      <div className="mx-auto max-w-2xl space-y-4">
        {!d ? (
          <div className="card p-6 text-center text-muted">{t.pl_not_found}</div>
        ) : (
          <>
            <article className="card p-6">
              <header className="mb-4 flex items-start justify-between gap-3 border-b border-line pb-3">
                <div>
                  <div className="text-lg font-bold">{d.hotel_ar}</div>
                  {d.hotel_en ? <div className="text-sm text-muted" dir="ltr">{d.hotel_en}</div> : null}
                </div>
                <div className="no-print"><PrintButton label={t.ct_print} /></div>
              </header>
              {d.status === "void" ? <div className="mb-3 rounded-xl bg-danger-soft p-3 text-center font-semibold text-danger">{t.ct_void}</div> : null}
              {!d.intact ? <div className="mb-3 flex items-center gap-2 rounded-xl bg-danger-soft p-3 text-sm text-danger"><TriangleAlert className="size-5 shrink-0" />{t.ct_tampered}</div> : null}
              <div dir="rtl" className="whitespace-pre-line text-sm leading-7">{d.body}</div>

              <div className="mt-6 grid gap-4 border-t border-line pt-4 sm:grid-cols-2">
                <div>
                  <div className="text-xs text-muted">{t.ct_party_hotel}</div>
                  <div className="font-semibold">{d.hotel_signer || d.hotel_ar}</div>
                  {d.hotel_signed_at ? <div className="text-xs text-ok">{t.ct_signed_at} {dateTime(d.hotel_signed_at, d.timezone, lang)}</div> : null}
                </div>
                <div>
                  <div className="text-xs text-muted">{t.ct_party_guest}</div>
                  {d.status === "signed" && d.guest_signature ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element -- inline signature image (data URL) */}
                      <img src={d.guest_signature} alt={d.guest_sign_name ?? ""} className="h-20 w-auto" />
                      <div className="font-semibold">{d.guest_sign_name}</div>
                      <div className="text-xs text-ok">{t.ct_signed_at} {d.guest_signed_at ? dateTime(d.guest_signed_at, d.timezone, lang) : ""}</div>
                    </>
                  ) : (
                    <div className="text-sm text-muted">{t.ct_awaiting}</div>
                  )}
                </div>
              </div>
              <p className="mt-4 flex items-start gap-1.5 text-[11px] text-muted"><ShieldCheck className="size-3.5 shrink-0" /><span>{t.ct_fingerprint}: <span dir="ltr" className="break-all font-mono">{d.hash}</span></span></p>
            </article>

            {d.status === "awaiting_guest" && d.intact ? (
              <div className="card no-print p-5">
                <h2 className="h2 mb-3">{t.ct_sign_here}</h2>
                <SignaturePad
                  token={token}
                  sign={signContract}
                  labels={{ name: t.ct_your_name, draw: t.ct_draw, clear: t.ct_clear, agree: t.ct_agree, submit: t.ct_sign, needAll: t.ct_need_all }}
                />
              </div>
            ) : d.status === "signed" ? (
              <div className="card no-print flex items-center justify-center gap-2 p-4 font-semibold text-ok"><CircleCheck className="size-5" />{t.ct_done}</div>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
