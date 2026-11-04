"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, LoaderCircle, Upload } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

/** Guest uploads the bank-transfer receipt for a payment link (no login). */
export function LinkProofUpload({ token, labels }: {
  token: string;
  labels: { choose: string; note: string; send: string; sending: string; done: string; error: string };
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  async function send() {
    if (!file) return;
    setState("busy");
    const supabase = createClient();
    const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const path = `${token}/${crypto.randomUUID()}.${ext}`;
    const up = await supabase.storage.from("link-proofs").upload(path, file, { contentType: file.type });
    if (up.error) return setState("error");
    const { error } = await supabase.rpc("submit_payment_link_proof", { p_token: token, p_path: path, p_note: note || null });
    if (error) return setState("error");
    setState("done");
    router.refresh();
  }

  if (state === "done") {
    return <div className="flex items-center justify-center gap-2 rounded-xl bg-ok-soft p-4 font-semibold text-ok"><CircleCheck className="size-5" />{labels.done}</div>;
  }
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-brand/50 p-4 text-sm text-brand">
        <Upload className="size-6" />
        <span>{file ? file.name : labels.choose}</span>
        <input type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={labels.note} className="input" />
      <button type="button" onClick={send} disabled={!file || state === "busy"} className="btn-primary inline-flex w-full items-center justify-center gap-2">
        {state === "busy" ? <LoaderCircle className="size-4 animate-spin" /> : null}{state === "busy" ? labels.sending : labels.send}
      </button>
      {state === "error" ? <p className="text-center text-sm text-danger">{labels.error}</p> : null}
    </div>
  );
}
