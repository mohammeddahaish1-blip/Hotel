import { Check } from "lucide-react";
import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { omr } from "@/lib/format";
import { PROPERTY_COLUMNS, photoUrls, propertyStats, type PropertyRow } from "@/lib/properties";
import { PropertyPhoto } from "@/components/PropertyPhoto";
import { Badge, PageHeader } from "@/components/ui";

export default async function PropertiesPage() {
  const ctx = await requireArea("board");
  const { t, lang } = await getDict();
  const { data } = await ctx.supabase.from("properties").select(PROPERTY_COLUMNS).eq("tenant_id", ctx.tenantId).order("created_at");
  const props = (data ?? []) as PropertyRow[];
  const [stats, photos] = await Promise.all([propertyStats(ctx, props), photoUrls(ctx, props)]);

  return (
    <>
      <PageHeader
        title={t.prop_title}
        sub={t.prop_sub}
        actions={ctx.role === "owner" ? <Link href="/properties/new" className="btn-primary">＋ {t.prop_new}</Link> : null}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {props.map((p) => {
          const st = stats.get(p.id)!;
          const pct = st.units ? Math.round((st.occupied / st.units) * 100) : 0;
          const name = lang === "en" && p.name_en ? p.name_en : p.name_ar;
          return (
            <Link key={p.id} href={`/properties/${p.id}`} className="card group overflow-hidden p-0 transition hover:-translate-y-0.5 hover:shadow-md">
              <div className="relative">
                <PropertyPhoto url={photos.get(p.id)} alt={name} className="h-44 w-full" />
                {p.id === ctx.property.id ? <span className="absolute start-3 top-3"><Badge tone="brand"><Check className="size-3.5 shrink-0" /> {t.prop_current}</Badge></span> : null}
              </div>
              <div className="p-5">
                <h2 className="text-lg font-bold group-hover:text-brand">{name}</h2>
                <div className="text-sm text-muted">{[t[`kind_${p.kind}` as DictKey], p.address].filter(Boolean).join("، ")}</div>
                <div className="mt-4 h-2 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-2 rounded-full bg-brand" style={{ width: `${pct}%` }} />
                </div>
                <div className="mt-2 text-sm text-muted"><b className="num text-ink">{st.occupied}</b> {t.prop_occupied} <span className="num">{st.units}</span></div>
                {st.collected !== null ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
                    <div><div className="text-xs text-muted">{t.prop_collected}</div><div className="num font-bold">{omr(st.collected, lang)}</div></div>
                    <div><div className="text-xs text-muted">{t.prop_outstanding}</div><div className={`num font-bold ${st.outstanding ? "text-danger" : ""}`}>{omr(st.outstanding ?? 0, lang)}</div></div>
                  </div>
                ) : null}
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
