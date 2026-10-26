import Link from "next/link";
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { isRtl, type DictKey } from "@/lib/i18n/dict";
import { gregorian, omr } from "@/lib/format";
import { counts, IMPORT_TYPES, type ImportRow, type ImportSheet, type ImportType } from "@/lib/import/detect";
import { importLabels } from "@/lib/import/labels";
import { cancelImport, commitImport, setSheetType } from "@/app/actions/import";
import { SubmitButton } from "@/components/ActionForm";
import { Badge, PageHeader, Stat, type Tone } from "@/components/ui";

const SHOW = 300;
const COLS: Record<ImportType, string[]> = {
  reservations: ["room", "guest", "phone", "from", "to", "source"],
  expenses: ["date", "category", "description", "method", "amount"],
  units: ["number", "type", "floor", "rate"],
  guests: ["name", "phone", "doc_number", "nationality"],
};
const STATUS: Record<ImportRow["status"], { icon: string; tone: Tone }> = {
  ok: { icon: "✅", tone: "ok" }, warn: { icon: "⚠️", tone: "warn" }, skip: { icon: "⏭️", tone: "gray" }, error: { icon: "❌", tone: "danger" },
};

export default async function ImportReviewPage({ params }: PageProps<"/import/[id]">) {
  const ctx = await requireArea("import");
  const { t, lang } = await getDict();
  const L = importLabels[lang];
  const { id } = await params;
  const [{ data: job }, { data: types }, { data: floors }] = await Promise.all([
    ctx.supabase.from("import_jobs").select("*").eq("id", id).maybeSingle(),
    ctx.supabase.from("unit_types").select("id, name_ar").eq("property_id", ctx.property.id),
    ctx.supabase.from("floors").select("id, name").eq("property_id", ctx.property.id),
  ]);
  if (!job) notFound();
  const sheets = (job.payload?.sheets ?? []) as ImportSheet[];
  const typeName = new Map((types ?? []).map((x) => [x.id, x.name_ar]));
  const floorName = new Map((floors ?? []).map((x) => [x.id, x.name]));
  const open = job.status === "validated";
  const savable = sheets.flatMap((s) => (s.type ? s.rows : [])).filter((r) => r.status === "ok" || r.status === "warn").length;
  const hasGuests = sheets.some((s) => s.type === "guests" || s.type === "reservations");
  const c = counts(sheets.flatMap((s) => s.rows));

  const show = (type: ImportType, col: string, d: ImportRow["data"]): string => {
    const v = (k: string) => (d[k] === null || d[k] === undefined ? "" : String(d[k]));
    switch (`${type}.${col}`) {
      case "expenses.date": return d.expense_date ? gregorian(v("expense_date"), lang) : "";
      case "expenses.category": return t[`ec_${v("category")}` as DictKey] ?? v("category");
      case "expenses.method": return t[`pm_${v("method")}` as DictKey] ?? v("method");
      case "expenses.amount": return d.amount ? omr(Number(d.amount), lang) : "";
      case "units.type": return v("new_type") || typeName.get(v("unit_type_id")) || "";
      case "units.floor": return v("new_floor") || floorName.get(v("floor_id")) || "";
      case "units.rate": return d.rate !== undefined ? omr(Number(d.rate), lang) : "";
      case "guests.name": return v("full_name");
      case "reservations.guest": return v("guest_name");
      case "reservations.from": return d.from ? gregorian(v("from"), lang) : "";
      case "reservations.to": return d.to ? gregorian(v("to"), lang) : "";
      case "reservations.source": return t[`src_${v("source")}` as DictKey] ?? v("source");
      default: return v(col);
    }
  };

  return (
    <>
      <PageHeader
        title={job.file_name.replace(/\.(xlsx|xlsm|csv|pdf)$/i, "")}
        sub={<><Link href="/import" className="text-brand">← {L.back}</Link> · {L.kind[job.file_kind]} · <Badge tone={job.status === "saved" ? "ok" : job.status === "validated" ? "warn" : "gray"}>● {L.st[job.status]}</Badge></>}
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label={L.sheets} value={sheets.length} />
        <Stat label={L.ready} value={c.ready} tone="ok" />
        <Stat label={L.warn} value={c.warnings} tone={c.warnings ? "warn" : undefined} />
        <Stat label={L.errors} value={c.errors} tone={c.errors ? "danger" : undefined} />
      </div>
      {!open && job.saved_at ? (
        <div className="mb-4 rounded-xl bg-ok-soft px-4 py-3 text-sm font-semibold text-ok">
          {L.result.replace("{saved}", String(job.saved)).replace("{failed}", String(job.failed))}
        </div>
      ) : null}

      <div className="space-y-4">
        {sheets.map((s, i) => (
          <section key={i} className="card">
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <h2 className="h2">📄 {s.name}</h2>
              {open ? (
                <form action={setSheetType} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={job.id} />
                  <input type="hidden" name="sheet" value={i} />
                  <label className="text-xs text-muted" htmlFor={`t${i}`}>{L.type}</label>
                  <select id={`t${i}`} name="type" defaultValue={s.type ?? ""} className="input w-auto py-1.5 text-sm">
                    <option value="">{L.typeNone}</option>
                    {IMPORT_TYPES.map((x) => <option key={x} value={x}>{L.types[x]}</option>)}
                  </select>
                  <SubmitButton className="btn-ghost btn-sm">↻</SubmitButton>
                </form>
              ) : s.type ? <Badge tone="brand">{L.types[s.type]}</Badge> : null}
              {s.type ? (() => {
                const k = counts(s.rows);
                return <span className="text-xs text-muted">✅ {k.ready} · ⚠️ {k.warnings} · ❌ {k.errors}</span>;
              })() : null}
            </div>

            {!s.type ? (
              <p className="text-sm text-muted">{L.notDetected}</p>
            ) : (
              <>
                <div className="mb-3 flex flex-wrap gap-1.5 text-xs">
                  <span className="text-muted">{L.columns}:</span>
                  {Object.entries(s.mapping).map(([f, col]) => (
                    <span key={f} className="rounded-full bg-surface-2 px-2 py-0.5">
                      «{s.header[col]}» {isRtl(lang) ? "←" : "→"} <b>{L.fields[f] ?? f}</b>
                    </span>
                  ))}
                </div>
                <div className="max-h-[32rem] overflow-auto">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>{L.row}</th>
                        <th></th>
                        {COLS[s.type].map((col) => <th key={col}>{L.fields[col]}</th>)}
                        <th>{L.notes}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.rows.slice(0, SHOW).map((r) => (
                        <tr key={r.n} className={r.status === "error" || r.result === "failed" ? "bg-danger-soft/40" : undefined}>
                          <td className="num text-xs text-muted">{r.n}</td>
                          <td title={r.status}>{r.result === "saved" ? "💾" : r.result === "failed" ? "❌" : STATUS[r.status].icon}</td>
                          {COLS[s.type!].map((col) => (
                            <td key={col} className="text-xs" dir="auto">{show(s.type!, col, r.data)}</td>
                          ))}
                          <td className="text-xs">
                            {r.result === "saved" ? <span className="text-ok">{L.saved}</span> : null}
                            {r.result === "failed" ? <span className="text-danger">{L.failed}: {r.error}</span> : null}
                            {!r.result ? r.notes.map((m) => (
                              <span key={m} className={`me-1 inline-block ${r.status === "error" ? "text-danger" : "text-warn"}`}>{L.m[m] ?? m}</span>
                            )) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {s.rows.length > SHOW ? (
                  <p className="mt-2 text-xs text-muted">{L.shown.replace("{n}", String(SHOW)).replace("{total}", String(s.rows.length))}</p>
                ) : null}
              </>
            )}
          </section>
        ))}
      </div>

      {open ? (
        <div className="sticky bottom-0 mt-4 flex flex-wrap items-center gap-3 border-t border-line bg-bg/95 py-3 backdrop-blur">
          <form action={commitImport}>
            <input type="hidden" name="id" value={job.id} />
            <SubmitButton className="btn-primary" confirm={L.saveConfirm.replace("{n}", String(savable))}>
              💾 {L.save.replace("{n}", String(savable))}
            </SubmitButton>
          </form>
          <form action={cancelImport}>
            <input type="hidden" name="id" value={job.id} />
            <SubmitButton className="btn-ghost">{L.cancel}</SubmitButton>
          </form>
          {hasGuests ? <p className="text-xs text-muted">ℹ️ {L.consent}</p> : null}
        </div>
      ) : null}
    </>
  );
}
