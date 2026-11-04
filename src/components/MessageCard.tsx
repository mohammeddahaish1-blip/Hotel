"use client";

import { useState, useTransition } from "react";
import { MessageCircle } from "lucide-react";
import { whatsappLink } from "@/lib/format";
import type { ActionResult } from "@/components/ActionForm";

/**
 * One queued guest message: staff can adjust the text, then send it through WhatsApp.
 * The tab opens straight from the click (so the browser allows it) and the message is
 * marked as sent with the exact text that went out.
 */
export function MessageCard({ id, phone, text, labels, markSent }: {
  id: string;
  phone: string | null;
  text: string;
  labels: { send: string; noPhone: string; sent: string };
  markSent: (id: string, text: string) => Promise<ActionResult>;
}) {
  const [value, setValue] = useState(text);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  function send() {
    window.open(whatsappLink(phone, value), "_blank", "noopener");
    start(async () => {
      const r = await markSent(id, value);
      if (r?.ok) setSent(true);
    });
  }

  return (
    <div className="space-y-2">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(8, value.split("\n").length + 1)} dir="auto" className="input text-sm" disabled={sent} />
      {sent ? (
        <span className="text-sm font-semibold text-ok">{labels.sent}</span>
      ) : phone ? (
        <button type="button" onClick={send} disabled={pending} className="btn-primary btn-sm inline-flex items-center gap-1.5">
          <MessageCircle className="size-4 shrink-0" />{labels.send}
        </button>
      ) : (
        <span className="text-xs text-warn">{labels.noPhone}</span>
      )}
    </div>
  );
}
