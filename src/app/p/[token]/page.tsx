import type { Metadata } from "next";
import { CircleCheck, Clock, Landmark } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { dictionaries } from "@/lib/i18n/dict";
import { gregorian, omr } from "@/lib/format";
import { LinkProofUpload } from "@/components/LinkProofUpload";

export const metadata: Metadata = { title: "دفع — Payment", robots: { index: false } };

type Link = {
  status: "open" | "proof_submitted" | "paid" | "cancelled" | "expired"; amount: number; purpose: string; note: string | null; expires_at: string;
  code: string; unit: string; guest: string; lang: string; hotel_ar: string; hotel_en: string | null; phone: string | null;
  bank_name: string | null; bank_account_name: string | null; bank_iban: string | null; instructions: string | null;
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public payment page opened from WhatsApp (no login), in the guest's language.
export default async function PayPage({ params }: PageProps<"/p/[token]">) {
  const { token } = await params;
  let l: Link | null = null;
  if (UUID.test(token)) {
    const { data } = await (await createClient()).rpc("payment_link_public", { p_token: token });
    l = (data as Link | null) ?? null;
  }
  const lang = l?.lang === "en" ? "en" : "ar";
  const t = dictionaries[lang];
  const hotel = l ? (lang === "en" && l.hotel_en) || l.hotel_ar : "";

  return (
    <div className="min-h-screen bg-bg px-4 py-8" dir={lang === "en" ? "ltr" : "rtl"} lang={lang}>
      <div className="mx-auto max-w-md space-y-4">
        {!l ? (
          <div className="card p-6 text-center text-muted">{t.pl_not_found}</div>
        ) : (
          <>
            <div className="card p-6 text-center">
              <div className="text-sm text-muted">{hotel}</div>
              <div className="mt-1 text-sm">{t.pl_hello.replace("{name}", l.guest)}</div>
              <div className="num mt-4 text-4xl font-bold text-brand">{omr(l.amount, lang)}</div>
              <div className="mt-1 text-sm text-muted">{t[`pl_purpose_${l.purpose}` as keyof typeof t] ?? ""} · {t.pl_ref} {l.code} · {t.unit} {l.unit}</div>
              {l.note ? <p className="mt-2 text-sm">{l.note}</p> : null}
            </div>

            {l.status === "paid" ? (
              <div className="card flex items-center justify-center gap-2 p-5 font-semibold text-ok"><CircleCheck className="size-5" />{t.pl_paid}</div>
            ) : l.status === "cancelled" || l.status === "expired" ? (
              <div className="card p-5 text-center text-muted">{l.status === "expired" ? t.pl_expired : t.pl_cancelled}</div>
            ) : (
              <>
                {l.status === "proof_submitted" ? (
                  <div className="card flex items-center gap-2 p-4 text-sm text-info"><Clock className="size-5 shrink-0" />{t.pl_proof_wait}</div>
                ) : null}
                <div className="card space-y-3 p-5">
                  <h2 className="h2 inline-flex items-center gap-2"><Landmark className="size-5 text-brand" />{t.pl_bank}</h2>
                  {l.bank_iban ? (
                    <dl className="space-y-2 text-sm">
                      {l.bank_name ? <div className="flex justify-between gap-3"><dt className="text-muted">{t.set_bank_name}</dt><dd className="font-semibold">{l.bank_name}</dd></div> : null}
                      {l.bank_account_name ? <div className="flex justify-between gap-3"><dt className="text-muted">{t.set_bank_account}</dt><dd className="font-semibold">{l.bank_account_name}</dd></div> : null}
                      <div className="flex justify-between gap-3"><dt className="text-muted">IBAN</dt><dd dir="ltr" className="num select-all font-semibold">{l.bank_iban}</dd></div>
                    </dl>
                  ) : (
                    <p className="text-sm text-muted">{t.pl_no_bank}{l.phone ? ` ${l.phone}` : ""}</p>
                  )}
                  {l.instructions ? <p className="whitespace-pre-line text-sm">{l.instructions}</p> : null}
                  <p className="text-xs text-muted">{t.pl_valid_until} {gregorian(l.expires_at.slice(0, 10), lang)}</p>
                </div>
                <div className="card space-y-3 p-5">
                  <h2 className="h2">{t.pl_upload}</h2>
                  <LinkProofUpload
                    token={token}
                    labels={{ choose: t.pl_choose, note: t.pl_note, send: t.pl_send, sending: t.pl_sending, done: t.pl_proof_wait, error: t.err_generic }}
                  />
                </div>
              </>
            )}
            {l.phone ? <p className="text-center text-xs text-muted">{t.pl_questions} <span dir="ltr">{l.phone}</span></p> : null}
          </>
        )}
      </div>
    </div>
  );
}
