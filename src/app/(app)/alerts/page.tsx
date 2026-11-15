import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { loadAlerts } from "@/lib/alerts";
import { PageHeader } from "@/components/ui";

const GROUPS = ["guests", "cheques", "payments", "contracts", "docs", "ops", "other"] as const;
const DOT = ["", "bg-danger", "bg-warn", "bg-info"];
const TONE = ["", "text-danger", "text-warn", "text-muted"];

/** Every alert meant for the person signed in, split into tabs; each row opens where it is handled. */
export default async function AlertsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const all = [...(await loadAlerts(ctx, t, lang))].sort((a, b) => a.severity - b.severity);
  const g = typeof sp.g === "string" && (GROUPS as readonly string[]).includes(sp.g) ? sp.g : "";
  const count = (k: string) => all.filter((a) => a.group === k).length;
  // only the tabs that have something in them
  const tabs = GROUPS.filter((k) => count(k) > 0);
  const shown = g ? all.filter((a) => a.group === g) : all;
  const tab = (key: string, label: string, n: number) => (
    <Link
      key={key || "all"}
      href={key ? `/alerts?g=${key}` : "/alerts"}
      aria-current={g === key ? "page" : undefined}
      className={`flex shrink-0 items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold ${g === key ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
    >
      {label}
      <span className={`num rounded-full px-2 text-xs ${g === key ? "bg-brand text-brand-ink" : "bg-surface"}`}>{n}</span>
    </Link>
  );

  return (
    <>
      <PageHeader title={t.alerts_page} sub={t.alerts_page_sub} />
      {all.length === 0 ? (
        <p className="card flex items-center gap-2 font-semibold text-ok"><CircleCheck className="size-5 shrink-0" /> {t.alerts_none}</p>
      ) : (
        <>
          {tabs.length > 1 ? (
            <nav className="mb-4 flex max-w-full gap-1 overflow-x-auto rounded-full bg-gray-soft p-1" aria-label={t.alerts_page}>
              {tab("", t.alg_all, all.length)}
              {tabs.map((k) => tab(k, t[`alg_${k}` as DictKey], count(k)))}
            </nav>
          ) : null}
          <ul className="space-y-2">
            {shown.map((a) => (
              <li key={a.key}>
                <Link href={a.href} className="card flex items-start gap-3 py-4 transition hover:shadow-md">
                  <span className={`mt-2 size-2.5 shrink-0 rounded-full ${DOT[a.severity] ?? "bg-info"}`} aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{a.title}</span>
                    {a.detail ? <span dir="auto" className="block text-sm text-muted">{a.detail}</span> : null}
                    <span className={`mt-0.5 block text-xs font-semibold ${TONE[a.severity] ?? "text-muted"}`}>{t[`al_sev_${a.severity}` as DictKey] ?? ""}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
