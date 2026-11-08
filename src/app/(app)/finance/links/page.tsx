import { requireFeature } from "@/lib/plan";
import { redirect } from "next/navigation";
import { hasRole, requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { omr } from "@/lib/format";
import { loadPaymentLinks } from "@/lib/paylinks";
import { PaymentLinksList } from "@/components/PaymentLinksList";
import { Empty, PageHeader, Section, Stat } from "@/components/ui";

/** Every payment link of the property: proofs waiting for confirmation first. */
export default async function PaymentLinksPage() {
  const ctx = await requireArea("finance");
  await requireFeature(ctx, "payment_links");
  if (!hasRole(ctx, ["manager", "reception", "accountant"])) redirect("/finance");
  const { t, lang } = await getDict();
  const links = await loadPaymentLinks(ctx, {});
  const now = new Date();
  const proof = links.filter((l) => l.status === "proof_submitted");
  const open = links.filter((l) => l.status === "open" && new Date(l.expires_at) > now);
  const done = links.filter((l) => !proof.includes(l) && !open.includes(l));
  const sum = (xs: typeof links) => xs.reduce((a, l) => a + l.amount, 0);
  const tz = ctx.property.timezone;
  return (
    <>
      <PageHeader title={t.pl_title} sub={t.pl_page_hint} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label={`${t.pl_st_proof_submitted} (${proof.length})`} value={omr(sum(proof), lang)} tone={proof.length ? "info" : undefined} />
        <Stat label={`${t.pl_st_open} (${open.length})`} value={omr(sum(open), lang)} tone={open.length ? "warn" : undefined} />
        <Stat label={`${t.pl_st_paid} (${links.filter((l) => l.status === "paid").length})`} value={omr(sum(links.filter((l) => l.status === "paid")), lang)} tone="ok" />
      </div>
      <div className="space-y-4">
        <Section title={t.pl_st_proof_submitted}>{proof.length ? <PaymentLinksList links={proof} t={t} lang={lang} tz={tz} showGuest /> : <Empty>{t.none}</Empty>}</Section>
        <Section title={t.pl_st_open}>{open.length ? <PaymentLinksList links={open} t={t} lang={lang} tz={tz} showGuest /> : <Empty>{t.none}</Empty>}</Section>
        {done.length ? <Section title={t.pl_history}><PaymentLinksList links={done.slice(0, 30)} t={t} lang={lang} tz={tz} showGuest /></Section> : null}
      </div>
    </>
  );
}
