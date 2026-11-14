"use client";

import { useRef, useState } from "react";

type Ph = { key: string; label: string; sample: string };

/**
 * One message in Arabic and English: buttons drop a placeholder at the cursor, and the preview shows the
 * message the way a guest gets it (with sample names). Posts key, name, body_ar and body_en.
 */
export function TemplateEditor({ tplKey, name, askName, bodyAr, bodyEn, placeholders, labels: l }: {
  tplKey: string; name: string; askName?: boolean; bodyAr: string; bodyEn: string; placeholders: Ph[];
  labels: { name: string; insert: string; body: string; preview: string; previewHint: string };
}) {
  const [tab, setTab] = useState<"ar" | "en">("ar");
  const [ar, setAr] = useState(bodyAr);
  const [en, setEn] = useState(bodyEn);
  const arRef = useRef<HTMLTextAreaElement>(null);
  const enRef = useRef<HTMLTextAreaElement>(null);
  const body = tab === "ar" ? ar : en;
  const insert = (k: string) => {
    const el = tab === "ar" ? arRef.current : enRef.current;
    const token = `{${k}}`;
    const at = el ? el.selectionStart : body.length;
    const end = el ? el.selectionEnd : body.length;
    const next = body.slice(0, at) + token + body.slice(end);
    if (tab === "ar") setAr(next); else setEn(next);
    // put the cursor right after what was added
    window.requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + token.length, at + token.length); });
  };
  const shown = placeholders.reduce((text, p) => text.replaceAll(`{${p.key}}`, p.sample), body);
  const tabCls = (on: boolean) => `rounded-full px-4 py-1.5 text-sm font-semibold ${on ? "bg-surface text-ink shadow-sm" : "text-muted"}`;
  return (
    <div className="space-y-3">
      <input type="hidden" name="key" value={tplKey} />
      {askName ? (
        <label className="block"><span className="label">{l.name}</span><input name="name" required defaultValue={name} className="input" /></label>
      ) : (
        <input type="hidden" name="name" value={name} />
      )}
      <div className="inline-flex gap-1 rounded-full bg-gray-soft p-1" role="tablist">
        <button type="button" role="tab" aria-selected={tab === "ar"} className={tabCls(tab === "ar")} onClick={() => setTab("ar")}>العربية</button>
        <button type="button" role="tab" aria-selected={tab === "en"} className={tabCls(tab === "en")} onClick={() => setTab("en")}>English</button>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="label">{l.insert}</div>
          <div className="mb-3 flex flex-wrap gap-1.5">
            {placeholders.map((p) => (
              <button key={p.key} type="button" className="rounded-full bg-brand-soft px-3 py-1.5 text-xs font-semibold text-brand" onClick={() => insert(p.key)}>{p.label}</button>
            ))}
          </div>
          <label className="block">
            <span className="label">{l.body}</span>
            <textarea ref={arRef} name="body_ar" required={!!askName} value={ar} onChange={(e) => setAr(e.target.value)} rows={8} dir="rtl" className={`input text-sm leading-7 ${tab === "ar" ? "" : "hidden"}`} />
            <textarea ref={enRef} name="body_en" value={en} onChange={(e) => setEn(e.target.value)} rows={8} dir="ltr" className={`input text-sm leading-7 ${tab === "en" ? "" : "hidden"}`} />
          </label>
        </div>
        <div>
          <div className="label">{l.preview}</div>
          <div className="min-h-48 rounded-3xl bg-surface-2 p-4">
            <div dir={tab === "ar" ? "rtl" : "ltr"} className="max-w-sm whitespace-pre-wrap break-words rounded-2xl rounded-es-md bg-ok-soft p-3 text-sm leading-7 text-ink">{shown || "…"}</div>
          </div>
          <p className="mt-1.5 text-xs text-muted">{l.previewHint}</p>
        </div>
      </div>
    </div>
  );
}
