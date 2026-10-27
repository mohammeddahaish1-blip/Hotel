import { Info, FileSpreadsheet, FileText } from "lucide-react";
import Link from "next/link";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { importLabels } from "@/lib/import/labels";
import { ImportDropzone } from "@/components/ImportDropzone";
import { Badge, Empty, PageHeader, type Tone } from "@/components/ui";

const TONE: Record<string, Tone> = { validated: "warn", saved: "ok", partial: "info", cancelled: "gray" };

export default async function ImportPage() {
  const ctx = await requireArea("import");
  const { lang } = await getDict();
  const L = importLabels[lang];
  const { data: jobs } = await ctx.supabase
    .from("import_jobs")
    .select("id, file_name, file_kind, created_at, sheets, ready, warnings, errors, saved, failed, status")
    .eq("property_id", ctx.property.id)
    .order("created_at", { ascending: false })
    .limit(100);
  const date = (d: string) => new Intl.DateTimeFormat("en-GB", { timeZone: ctx.property.timezone }).format(new Date(d));

  return (
    <>
      <PageHeader title={L.title} sub={L.sub} />
      <ImportDropzone labels={{ drop: L.drop, dropHint: L.dropHint, dropTypes: L.dropTypes, reading: L.reading, done: L.done, errSize: L.errSize }} />
      <p className="mb-4 flex items-center gap-1.5 text-xs text-muted"><Info className="size-3.5 shrink-0" />{L.supported}</p>
      <section className="card overflow-hidden p-0">
        <h2 className="h2 px-5 py-4">{L.jobs}</h2>
        {!jobs?.length ? (
          <div className="px-5 pb-5"><Empty>{L.none}</Empty></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr><th>{L.file}</th><th>{L.date}</th><th>{L.sheets}</th><th>{L.ready}</th><th>{L.warn}</th><th>{L.errors}</th><th>{L.status}</th></tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>
                      <Link href={`/import/${j.id}`} className="flex items-start gap-2 hover:text-brand">
                        <span aria-hidden className="mt-0.5 text-muted">{j.file_kind === "pdf" ? <FileText className="size-5" /> : <FileSpreadsheet className="size-5" />}</span>
                        <span>
                          <span className="block font-semibold">{j.file_name.replace(/\.(xlsx|xlsm|csv|pdf)$/i, "")}</span>
                          <span className="block text-xs text-muted">{L.kind[j.file_kind]}</span>
                        </span>
                      </Link>
                    </td>
                    <td className="num whitespace-nowrap">{date(j.created_at)}</td>
                    <td className="num">{j.sheets}</td>
                    <td className="num">{j.ready}</td>
                    <td className="num">{j.warnings}</td>
                    <td className={`num ${j.errors ? "text-danger" : ""}`}>{j.errors}</td>
                    <td><Badge tone={TONE[j.status]}>● {L.st[j.status]}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
