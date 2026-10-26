"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { analyzeImport } from "@/app/actions/import";

type Item = { name: string; state: "reading" | "done" | "error"; msg?: string; id?: string };
type Labels = { drop: string; dropHint: string; dropTypes: string; reading: string; done: string; errSize: string };

const MAX = 4 * 1024 * 1024;

/** Drop or pick several files; each is read on the server and becomes an import job to review. */
export function ImportDropzone({ labels }: { labels: Labels }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [items, setItems] = useState<Item[]>([]);

  async function handle(files: FileList | null) {
    if (!files?.length) return;
    const list = [...files];
    const start = items.length;
    setItems((x) => [...x, ...list.map((f) => ({ name: f.name, state: "reading" as const }))]);
    const ids: string[] = [];
    for (let i = 0; i < list.length; i++) {
      const f = list[i];
      let next: Item;
      if (f.size > MAX) next = { name: f.name, state: "error", msg: labels.errSize };
      else {
        const fd = new FormData();
        fd.set("file", f);
        try {
          const r = await analyzeImport(fd);
          next = r.id ? { name: f.name, state: "done", id: r.id } : { name: f.name, state: "error", msg: r.error };
          if (r.id) ids.push(r.id);
        } catch {
          next = { name: f.name, state: "error", msg: labels.errSize };
        }
      }
      setItems((x) => x.map((it, k) => (k === start + i ? next : it)));
    }
    if (input.current) input.current.value = "";
    if (list.length === 1 && ids.length === 1) router.push(`/import/${ids[0]}`);
    else router.refresh();
  }

  return (
    <div className="mb-5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => { e.preventDefault(); setOver(false); handle(e.dataTransfer.files); }}
        className={`flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-10 text-center transition ${
          over ? "border-brand bg-brand-soft" : "border-line bg-surface-2/60 hover:border-brand/60"
        }`}
      >
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-warn" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
        </svg>
        <span className="text-lg font-bold">{labels.drop}</span>
        <span className="text-sm text-muted">{labels.dropHint}</span>
        <span className="text-xs text-muted">{labels.dropTypes}</span>
      </button>
      <input ref={input} type="file" multiple accept=".xlsx,.xlsm,.csv,.pdf" className="hidden" onChange={(e) => handle(e.target.files)} />
      {items.length ? (
        <ul className="mt-3 space-y-1.5 text-sm">
          {items.map((it, i) => (
            <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl bg-surface px-3 py-2">
              <span>{it.state === "reading" ? "⏳" : it.state === "done" ? "✅" : "❌"}</span>
              <span className="font-medium">{it.name}</span>
              <span className={`text-xs ${it.state === "error" ? "text-danger" : "text-muted"}`}>
                {it.state === "reading" ? labels.reading : it.state === "done" ? labels.done : it.msg}
              </span>
              {it.id ? <a href={`/import/${it.id}`} className="ms-auto text-xs text-brand">→</a> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
