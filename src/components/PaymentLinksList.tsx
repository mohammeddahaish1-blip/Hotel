import { Link2, MessageCircle, Paperclip } from "lucide-react";
import type { Dict, DictKey, Lang } from "@/lib/i18n/dict";
import { dateTime, omr, whatsappLink } from "@/lib/format";
import { cancelPaymentLink, confirmPaymentLink } from "@/app/actions/money";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, EditDetails, type Tone } from "@/components/ui";

export type PayLink = {
  id: string; token: string; amount: number; purpose: string; status: string; created_at: string; expires_at: string;
  proof_path: string | null; payer_note: string | null; reservation_id: string;
  url: string; proofUrl?: string | null; guest?: string | null; phone?: string | null; code?: string | null; unit?: string | null; message: string;
};
const TONE: Record<string, Tone> = { open: "warn", proof_submitted: "info", paid: "ok", cancelled: "gray" };

/** Payment links with share / proof / confirm / cancel; used on a booking and on the finance tab. */
export function PaymentLinksList({ links, t, lang, tz, showGuest }: { links: PayLink[]; t: Dict; lang: Lang; tz: string; showGuest?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {links.map((l) => {
        const expired = l.status === "open" && new Date(l.expires_at) < new Date();
        const live = l.status === "open" || l.status === "proof_submitted";
        return (
          <li key={l.id} className="space-y-1.5 py-2.5 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="num font-bold">{omr(l.amount, lang)}</span>
              <Badge tone={expired ? "gray" : TONE[l.status]}>{expired ? t.pl_st_expired : t[`pl_st_${l.status}` as DictKey]}</Badge>
              <span className="text-xs text-muted">{t[`pl_purpose_${l.purpose}` as DictKey]}</span>
              {showGuest ? <span className="text-xs">{l.code} · {l.unit} · {l.guest}</span> : null}
              <span className="ms-auto text-xs text-muted">{dateTime(l.created_at, tz, lang)}</span>
            </div>
            {l.payer_note ? <p className="text-xs text-muted">“{l.payer_note}”</p> : null}
            <div className="flex flex-wrap items-start gap-1.5">
              {live && !expired ? (
                <>
                  <a href={l.url} target="_blank" rel="noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1"><Link2 className="size-3.5 shrink-0" />{t.pl_open}</a>
                  {l.phone ? (
                    <a href={whatsappLink(l.phone, l.message)} target="_blank" rel="noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1"><MessageCircle className="size-3.5 shrink-0" />{t.rc_send}</a>
                  ) : null}
                </>
              ) : null}
              {l.proofUrl ? (
                <a href={l.proofUrl} target="_blank" rel="noreferrer" className="btn-ghost btn-sm inline-flex items-center gap-1"><Paperclip className="size-3.5 shrink-0" />{t.rc_proof}</a>
              ) : null}
              {live ? (
                <>
                  <EditDetails label={t.pl_confirm}>
                    <ActionForm action={confirmPaymentLink} className="flex flex-wrap gap-1.5">
                      <input type="hidden" name="id" value={l.id} />
                      <input type="hidden" name="res" value={l.reservation_id} />
                      <select name="method" defaultValue="transfer" aria-label={t.method} className="input w-auto py-1.5">
                        {["transfer", "link", "card", "cash"].map((m) => <option key={m} value={m}>{t[`pm_${m}` as DictKey]}</option>)}
                      </select>
                      <input name="amount" defaultValue={(l.amount / 1000).toFixed(3)} inputMode="decimal" aria-label={t.amount} className="input w-28 py-1.5" />
                      <SubmitButton className="btn-primary btn-sm" confirm={t.pl_confirm_q}>{t.pl_confirm}</SubmitButton>
                    </ActionForm>
                  </EditDetails>
                  <ActionForm action={cancelPaymentLink}>
                    <input type="hidden" name="id" value={l.id} />
                    <input type="hidden" name="res" value={l.reservation_id} />
                    <SubmitButton className="btn-ghost btn-sm text-danger" confirm={t.confirm_cancel}>{t.cancel}</SubmitButton>
                  </ActionForm>
                </>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
