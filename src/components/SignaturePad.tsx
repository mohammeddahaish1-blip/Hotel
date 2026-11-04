"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eraser, PenLine } from "lucide-react";
import type { ActionResult } from "@/components/ActionForm";

/** Draw-your-signature box + name + consent, then signs the contract. */
export function SignaturePad({ token, sign, labels }: {
  token: string;
  sign: (token: string, name: string, signature: string) => Promise<ActionResult>;
  labels: { name: string; draw: string; clear: string; agree: string; submit: string; needAll: string };
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [drawn, setDrawn] = useState(false);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const g = c.getContext("2d")!;
    g.scale(ratio, ratio);
    g.lineWidth = 2.2;
    g.lineCap = "round";
    g.lineJoin = "round";
    g.strokeStyle = "#0d3b35";
  }, []);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  function down(e: React.PointerEvent<HTMLCanvasElement>) {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const g = e.currentTarget.getContext("2d")!;
    const [x, y] = pos(e);
    g.beginPath();
    g.moveTo(x, y);
  }
  function move(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const g = e.currentTarget.getContext("2d")!;
    const [x, y] = pos(e);
    g.lineTo(x, y);
    g.stroke();
    setDrawn(true);
  }
  function clear() {
    const c = canvas.current!;
    c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
    setDrawn(false);
  }
  function submit() {
    if (!drawn || name.trim().length < 2 || !agree) return setError(labels.needAll);
    setError(null);
    const data = canvas.current!.toDataURL("image/png");
    start(async () => {
      const r = await sign(token, name.trim(), data);
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  }

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="label">{labels.name}</span>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="input" autoComplete="name" />
      </label>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="label inline-flex items-center gap-1.5"><PenLine className="size-4" />{labels.draw}</span>
          <button type="button" onClick={clear} className="btn-ghost btn-sm inline-flex items-center gap-1"><Eraser className="size-3.5" />{labels.clear}</button>
        </div>
        <canvas
          ref={canvas}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={() => (drawing.current = false)}
          onPointerLeave={() => (drawing.current = false)}
          className="h-44 w-full touch-none rounded-xl border-2 border-dashed border-brand/40 bg-white"
        />
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1" />
        <span>{labels.agree}</span>
      </label>
      {error ? <p className="text-sm text-danger">{error}</p> : null}
      <button type="button" onClick={submit} disabled={pending} className="btn-primary w-full">{pending ? "…" : labels.submit}</button>
    </div>
  );
}
