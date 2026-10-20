"use client";

import { useEffect, useRef, useState } from "react";
import { omr, toBaisa } from "@/lib/format";

/** Amount field that shows the value as it will be recorded and asks before saving an unusually large one. */
export function AmountInput({ name = "amount", defaultValue, lang, preview, bigConfirm, threshold = 5_000_000 }: {
  name?: string; defaultValue?: string; lang: "ar" | "en"; preview: string; bigConfirm: string; threshold?: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(defaultValue ?? "");
  const baisa = value.trim() ? toBaisa(value) : 0;

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onSubmit = (e: SubmitEvent) => {
      const v = toBaisa(ref.current?.value ?? "");
      if (v > threshold && !window.confirm(bigConfirm.replace("{amount}", omr(v, lang)))) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    form.addEventListener("submit", onSubmit);
    return () => form.removeEventListener("submit", onSubmit);
  }, [bigConfirm, lang, threshold]);

  return (
    <div>
      <input
        ref={ref}
        name={name}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        required
        inputMode="decimal"
        placeholder="0.000"
        className="input"
      />
      {baisa > 0 ? (
        <div className={`mt-1 text-xs ${baisa > threshold ? "font-semibold text-warn" : "text-muted"}`}>
          {preview} <span className="num" dir="auto">{omr(baisa, lang)}</span>
        </div>
      ) : null}
    </div>
  );
}

/** Receipt photo/PDF picker; large photos are scaled down in the browser before upload. */
export function ReceiptInput({ name = "receipt", label, ready }: { name?: string; label: string; ready: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [done, setDone] = useState(false);

  async function shrink(file: File): Promise<File> {
    if (!file.type.startsWith("image/") || file.size < 900_000) return file;
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.82));
    return blob ? new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file;
  }

  return (
    <label className="block text-xs font-semibold text-muted">
      {label}
      <input
        ref={ref}
        type="file"
        name={name}
        accept="image/*,application/pdf"
        className="input mt-1 text-xs"
        onChange={async (e) => {
          setDone(false);
          const f = e.target.files?.[0];
          if (!f) return;
          const small = await shrink(f);
          if (small !== f && ref.current) {
            const dt = new DataTransfer();
            dt.items.add(small);
            ref.current.files = dt.files;
          }
          setDone(true);
        }}
      />
      {done ? <span className="mt-1 block text-ok">{ready}</span> : null}
    </label>
  );
}

/** Opens each overdue guest's WhatsApp reminder in turn (browsers block opening many tabs at once). */
export function RemindAll({ items, label, hint }: { items: { key: string; name: string; amount: string; href: string }[]; label: string; hint: string }) {
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<Set<string>>(new Set());
  if (!items.length) return null;
  return (
    <div className="mb-3">
      <button type="button" className="btn-ghost btn-sm" onClick={() => setOpen((o) => !o)}>
        💬 {label} ({items.length})
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border border-line p-3">
          <p className="mb-2 text-xs text-muted">{hint}</p>
          <ul className="space-y-1.5">
            {items.map((x) => (
              <li key={x.key}>
                <a
                  href={x.href}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => setSent((s) => new Set(s).add(x.key))}
                  className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-brand-soft ${sent.has(x.key) ? "text-muted line-through" : ""}`}
                >
                  <span>{sent.has(x.key) ? "✓ " : ""}{x.name}</span>
                  <span className="num text-xs" dir="auto">{x.amount}</span>
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
