"use client";

import { useRef, useState } from "react";
import { CircleCheck, Pencil, Undo2, UserCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { scanDocument, type ScannedGuest } from "@/lib/mrz";
import type { Dict } from "@/lib/i18n/dict";
import { errorMessage } from "@/lib/errors";
import type { CardRead } from "@/lib/card-reader";
import { CardReader } from "@/components/CardReader";

type Source = "reader" | "camera";
type Scanned = { before: GuestInput; beforeFile: File | null; data: CardRead; source: Source };
type Match = { id: string; full_name: string };

export type GuestInput = {
  id?: string;
  full_name?: string | null;
  full_name_ar?: string | null;
  nationality?: string | null;
  doc_type?: string | null;
  doc_number?: string | null;
  doc_expiry?: string | null;
  date_of_birth?: string | null;
  gender?: string | null;
  phone?: string | null;
  email?: string | null;
  preferred_language?: string | null;
  notes?: string | null;
  consent_transfer_abroad?: boolean | null;
  doc_source?: string | null;
};

export function GuestForm({
  t,
  tenantId,
  retentionDays,
  next,
  guest,
  demo,
  autoRead,
}: {
  t: Dict;
  tenantId: string;
  retentionDays: number;
  next?: string;
  guest?: GuestInput;
  /** Owner/manager: offer a fictional test card in the reader panel */
  demo?: boolean;
  /** Open the card reader straight away (from "register guest by card") */
  autoRead?: boolean;
}) {
  const router = useRouter();
  const [values, setValues] = useState<GuestInput>(guest ?? { preferred_language: "ar" });
  const [file, setFile] = useState<File | null>(null);
  const [scan, setScan] = useState<"idle" | "busy" | "ok" | "fail">("idle");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [scanned, setScanned] = useState<Scanned | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [useMatch, setUseMatch] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const editing = Boolean(guest?.id);

  /** Put what the card/photo gave into the form, remembering the previous values for "undo". */
  function applyScan(r: CardRead, source: Source, image: File | null) {
    setScanned({ before: values, beforeFile: file, data: r, source });
    setValues((v) => ({
      ...v,
      full_name: r.full_name ?? v.full_name,
      full_name_ar: r.full_name_ar ?? v.full_name_ar,
      nationality: r.nationality ?? v.nationality,
      doc_type: r.doc_type ?? v.doc_type,
      doc_number: r.doc_number ?? v.doc_number,
      doc_expiry: r.doc_expiry ?? v.doc_expiry,
      date_of_birth: r.date_of_birth ?? v.date_of_birth,
      gender: r.gender ?? v.gender,
    }));
    if (image) setFile(image);
    setMatch(null);
    setUseMatch(false);
    if (!editing && r.doc_number) void findExisting(r.doc_number);
  }

  async function findExisting(docNumber: string) {
    const { data } = await createClient().from("guests").select("id, full_name").eq("doc_number", docNumber).limit(1).maybeSingle();
    if (data) setMatch(data);
  }

  function undoScan() {
    if (!scanned) return;
    setValues(scanned.before);
    setFile(scanned.beforeFile);
    setScanned(null);
    setMatch(null);
    setUseMatch(false);
    setScan("idle");
  }

  const set = (k: keyof GuestInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((v) => ({ ...v, [k]: e.target.value }));

  async function onScan(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setScan("busy");
    try {
      const r: ScannedGuest | null = await scanDocument(f);
      if (!r) {
        setFile(f); // keep the photo as the guest's document even if it could not be read
        return setScan("fail");
      }
      applyScan(r, "camera", f);
      setScan("ok");
    } catch {
      setFile(f);
      setScan("fail");
    }
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const target = useMatch && match ? match.id : guest?.id;
    if (!target && fd.get("consent") !== "on") return setError(t.consent_required);
    setPending(true);
    setError(null);
    const supabase = createClient();
    const clean = (s: unknown) => (typeof s === "string" && s.trim() !== "" ? s.trim() : null);
    const row = {
      full_name: String(values.full_name ?? "").trim(),
      full_name_ar: clean(values.full_name_ar),
      nationality: clean(values.nationality)?.toUpperCase() ?? null,
      doc_type: clean(values.doc_type),
      doc_number: clean(values.doc_number),
      doc_expiry: clean(values.doc_expiry),
      date_of_birth: clean(values.date_of_birth),
      gender: clean(values.gender),
      phone: clean(values.phone),
      email: clean(values.email),
      preferred_language: values.preferred_language === "en" ? "en" : "ar",
      notes: clean(values.notes),
    };
    // Where the ID data came from: kept as scanned unless the document number was retyped
    const docChanged = row.doc_number !== (guest?.doc_number ?? null);
    const source = scanned && row.doc_number === (scanned.data.doc_number ?? null) ? scanned.source : docChanged && row.doc_number ? "manual" : null;
    const provenance = source ? { doc_source: source, doc_scanned_at: source === "manual" ? null : new Date().toISOString() } : {};
    let id = target;
    if (id) {
      // Existing guest found by the card: only overwrite what the card/form actually filled
      const patch = useMatch
        ? Object.fromEntries(Object.entries(row).filter(([k, v]) => v !== null && v !== "" && k !== "preferred_language"))
        : row;
      const { error } = await supabase.from("guests").update({ ...patch, ...provenance }).eq("id", id);
      if (error) {
        setPending(false);
        return setError(errorMessage(t, error));
      }
    } else {
      const { data, error } = await supabase
        .from("guests")
        .insert({
          ...row,
          ...provenance,
          tenant_id: tenantId,
          consent_at: new Date().toISOString(),
          consent_transfer_abroad: fd.get("consent_abroad") === "on",
        })
        .select("id")
        .single();
      if (error) {
        setPending(false);
        return setError(errorMessage(t, error));
      }
      id = data.id;
    }
    if (file && id) {
      const ext = file.type === "image/png" ? "png" : file.type === "application/pdf" ? "pdf" : "jpg";
      const path = `${tenantId}/${id}/${crypto.randomUUID()}.${ext}`;
      const up = await supabase.storage.from("guest-docs").upload(path, file, { contentType: file.type });
      if (!up.error) {
        const deleteAfter = new Date(Date.now() + retentionDays * 86400000).toISOString().slice(0, 10);
        await supabase.from("guest_documents").insert({
          tenant_id: tenantId,
          guest_id: id,
          storage_path: path,
          kind: row.doc_type ?? "other",
          delete_after: deleteAfter,
        });
      }
    }
    setPending(false);
    router.push(next ? `${next}${next.includes("?") ? "&" : "?"}guest=${id}` : `/guests/${id}`);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      {scanned ? (
        <div className="rounded-2xl border border-ok/40 bg-ok-soft/50 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <CircleCheck className="size-5 shrink-0 text-ok" />
            <span className="flex-1 font-semibold text-ok">{scanned.source === "reader" ? t.rd_done : t.guest_scan_ok}</span>
            <button type="button" onClick={() => nameRef.current?.focus()} className="btn-ghost btn-sm inline-flex items-center gap-1.5">
              <Pencil className="size-3.5 shrink-0" />{t.edit}
            </button>
            <button type="button" onClick={undoScan} className="btn-ghost btn-sm inline-flex items-center gap-1.5 text-danger">
              <Undo2 className="size-3.5 shrink-0" />{t.rd_undo}
            </button>
          </div>
          <div className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2" dir="auto">
            {scanned.data.full_name ? <div><span className="text-muted">{t.full_name}: </span><b dir="ltr">{scanned.data.full_name}</b></div> : null}
            {scanned.data.doc_number ? <div><span className="text-muted">{t.doc_number}: </span><b dir="ltr">{scanned.data.doc_number}</b></div> : null}
            {scanned.data.nationality ? <div><span className="text-muted">{t.nationality}: </span><b>{scanned.data.nationality}</b></div> : null}
            {scanned.data.doc_expiry ? <div><span className="text-muted">{t.doc_expiry}: </span><b dir="ltr">{scanned.data.doc_expiry}</b></div> : null}
          </div>
          {file && scanned.source === "reader" ? <p className="mt-2 text-xs text-muted">{t.rd_photo}</p> : null}
          {match ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl bg-surface p-2 text-sm">
              <UserCheck className="size-4 shrink-0 text-info" />
              <span className="flex-1">{t.rd_existing.replace("{name}", match.full_name)}</span>
              {useMatch ? (
                <button type="button" onClick={() => setUseMatch(false)} className="btn-ghost btn-sm">{t.rd_ignore}</button>
              ) : (
                <button type="button" onClick={() => setUseMatch(true)} className="btn-primary btn-sm">{t.rd_use_existing}</button>
              )}
            </div>
          ) : null}
        </div>
      ) : (
        <div className="rounded-2xl border border-brand/40 p-4">
          <p className="mb-3 text-xs text-muted">{t.rd_hint}</p>
          <CardReader
            labels={{ read: t.rd_read, detecting: t.rd_detecting, insert: t.rd_insert, swipe: t.rd_swipe, bad: t.rd_bad, bridgeError: t.rd_bridge_err, demo: t.rd_demo, cancel: t.cancel }}
            onRead={(r) => applyScan(r, "reader", r.image ?? null)}
            demo={demo}
            autoStart={autoRead}
          />
        </div>
      )}
      <div className="rounded-2xl border border-dashed border-brand/40 bg-brand-soft/40 p-4">
        <div className="mb-1 font-semibold text-brand">{t.guest_scan}</div>
        <p className="mb-3 text-xs text-muted">{t.guest_scan_hint}</p>
        <input type="file" accept="image/*" capture="environment" onChange={onScan} className="text-sm" />
        {scan === "busy" ? <div className="mt-2 text-sm text-info">{t.guest_scanning}</div> : null}
        {scan === "ok" ? <div className="mt-2 text-sm text-ok">{t.guest_scan_ok}</div> : null}
        {scan === "fail" ? <div className="mt-2 text-sm text-warn">{t.guest_scan_failed}</div> : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <L label={t.full_name}><input ref={nameRef} required dir="ltr" className="input" value={values.full_name ?? ""} onChange={set("full_name")} /></L>
        <L label={t.full_name_ar}><input className="input" value={values.full_name_ar ?? ""} onChange={set("full_name_ar")} /></L>
        <L label={t.doc_type}>
          <select className="input" value={values.doc_type ?? ""} onChange={set("doc_type")}>
            <option value="">—</option>
            {(["oman_id", "gcc_id", "passport", "resident_card", "other"] as const).map((d) => (
              <option key={d} value={d}>{t[`dt_${d}`]}</option>
            ))}
          </select>
        </L>
        <L label={t.doc_number}><input dir="ltr" className="input" value={values.doc_number ?? ""} onChange={set("doc_number")} /></L>
        <L label={t.nationality}><input dir="ltr" maxLength={3} className="input uppercase" value={values.nationality ?? ""} onChange={set("nationality")} /></L>
        <L label={t.doc_expiry}><input type="date" className="input" value={values.doc_expiry ?? ""} onChange={set("doc_expiry")} /></L>
        <L label={t.dob}><input type="date" className="input" value={values.date_of_birth ?? ""} onChange={set("date_of_birth")} /></L>
        <L label={t.gender}>
          <select className="input" value={values.gender ?? ""} onChange={set("gender")}>
            <option value="">—</option>
            <option value="M">{t.male}</option>
            <option value="F">{t.female}</option>
          </select>
        </L>
        <L label={t.phone}><input dir="ltr" type="tel" placeholder="+968" className="input" value={values.phone ?? ""} onChange={set("phone")} /></L>
        <L label={t.email}><input dir="ltr" type="email" className="input" value={values.email ?? ""} onChange={set("email")} /></L>
        <L label={t.pref_lang}>
          <select className="input" value={values.preferred_language ?? "ar"} onChange={set("preferred_language")}>
            <option value="ar">العربية</option>
            <option value="en">English</option>
          </select>
        </L>
        <L label={t.notes}><input className="input" value={values.notes ?? ""} onChange={set("notes")} /></L>
      </div>

      {!editing && !useMatch ? (
        <div className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" name="consent" required className="mt-1" />
            <span>{t.consent_label}</span>
          </label>
          <label className="flex items-start gap-2">
            <input type="checkbox" name="consent_abroad" className="mt-1" />
            <span>{t.consent_abroad}</span>
          </label>
        </div>
      ) : null}

      {error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div> : null}
      <button className="btn-primary" disabled={pending || scan === "busy"}>{pending ? "…" : t.save}</button>
    </form>
  );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}
