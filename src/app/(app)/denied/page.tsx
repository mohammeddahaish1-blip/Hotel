import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { AREAS, getCtx, homeFor } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";

/** Shown instead of a silent redirect when someone opens a section they were not given. */
export default async function DeniedPage({ searchParams }: PageProps<"/denied">) {
  const ctx = await getCtx();
  const { t } = await getDict();
  const sp = await searchParams;
  const area = typeof sp.area === "string" && (AREAS as readonly string[]).includes(sp.area) ? sp.area : null;
  const name = area ? (t[`nav_${area}` as DictKey] ?? area) : "";
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="card max-w-md space-y-3 p-6 text-center">
        <ShieldAlert className="mx-auto size-10 text-warn" aria-hidden />
        <h1 className="h1">{t.denied_title}</h1>
        <p className="text-sm text-muted">{area ? t.denied_body.replace("{area}", name) : t.denied_body_generic}</p>
        <Link href={homeFor(ctx)} className="btn-primary inline-flex">{t.denied_home}</Link>
      </div>
    </div>
  );
}
