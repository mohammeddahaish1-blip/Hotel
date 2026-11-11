import { Check, Lock } from "lucide-react";
import { getCtx } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { omr } from "@/lib/format";
import { FEATURES, getPlan } from "@/lib/plan";
import { PageHeader } from "@/components/ui";

type PlanRow = { code: string; name_ar: string; name_en: string | null; monthly_price: number; max_units: number | null; max_properties: number | null; features: string[] };

/** Shown instead of a page whose feature is outside the company's plan: what it is and which plans include it. */
export default async function UpgradePage({ searchParams }: PageProps<"/upgrade">) {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  const sp = await searchParams;
  const f = typeof sp.f === "string" && (FEATURES as readonly string[]).includes(sp.f) ? sp.f : null;
  const [plan, { data }] = await Promise.all([
    getPlan(ctx),
    ctx.supabase.from("plans").select("code, name_ar, name_en, monthly_price, max_units, max_properties, features").eq("active", true).order("sort"),
  ]);
  const plans = (data ?? []) as PlanRow[];
  const fname = (k: string) => t[`feat_${k}` as DictKey] ?? k;
  const pname = (p: { name_ar: string; name_en: string | null }) => ((lang === "en" || lang === "bn") && p.name_en ? p.name_en : p.name_ar);

  return (
    <>
      <PageHeader title={f ? t.up_title : t.sub_title} />
      {f ? (
        <div className="card mb-4 flex items-start gap-3">
          <Lock className="mt-0.5 size-5 shrink-0 text-warn" aria-hidden />
          <p className="text-sm">{t.up_body.replace("{feature}", fname(f)).replace("{plan}", plan.name ?? "—")}</p>
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        {plans.map((p) => {
          const current = p.code === plan.code;
          const wanted = f ? p.features.includes(f) : false;
          return (
            <section key={p.code} className={`card space-y-3 ${current ? "border-brand" : wanted ? "border-ok" : ""}`}>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-lg font-bold">{pname(p)}</h2>
                {current ? <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">{t.up_current}</span> : null}
              </div>
              <div className="num text-2xl font-bold">{omr(p.monthly_price, lang)} <span className="text-sm font-normal text-muted">{t.up_month}</span></div>
              <ul className="space-y-1.5 text-sm">
                <li>{p.max_units ? t.up_units.replace("{n}", String(p.max_units)) : t.up_units_any}</li>
                <li>{p.max_properties ? t.up_props.replace("{n}", String(p.max_properties)) : t.up_props_any}</li>
                <li className="flex items-center gap-1.5"><Check className="size-4 shrink-0 text-ok" aria-hidden /> {t.up_core}</li>
                {FEATURES.filter((x) => p.features.includes(x)).map((x) => (
                  <li key={x} className={`flex items-center gap-1.5 ${x === f ? "font-bold text-ok" : ""}`}>
                    <Check className="size-4 shrink-0 text-ok" aria-hidden /> {fname(x)}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted">{t.up_contact}</p>
    </>
  );
}
