"use client";

import { useRef, useState, useTransition } from "react";
import { LoaderCircle, SendHorizontal, Sparkles } from "lucide-react";

type Turn = { role: "user" | "assistant"; text: string };

/** Chat with the hotel assistant; the conversation lives in this page only. */
export function AssistantChat({ ask, suggestions, labels }: {
  ask: (history: Turn[], question: string) => Promise<{ answer?: string; error?: string }>;
  suggestions: string[];
  labels: { placeholder: string; send: string; thinking: string };
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const end = useRef<HTMLDivElement>(null);

  function send(q: string) {
    const question = q.trim();
    if (!question || pending) return;
    const history = turns;
    setTurns([...history, { role: "user", text: question }]);
    setText("");
    setError(null);
    start(async () => {
      const r = await ask(history, question);
      if (r.answer) setTurns((x) => [...x, { role: "assistant", text: r.answer! }]);
      else setError(r.error ?? "");
      setTimeout(() => end.current?.scrollIntoView({ behavior: "smooth" }), 50);
    });
  }

  return (
    <div className="card flex min-h-[60vh] flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto pb-3">
        {turns.length === 0 ? (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button key={s} type="button" onClick={() => send(s)} className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-brand hover:text-brand">
                {s}
              </button>
            ))}
          </div>
        ) : null}
        {turns.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div className={`max-w-[85%] whitespace-pre-line rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-brand text-brand-ink" : "bg-surface-2"}`} dir="auto">
              {m.role === "assistant" ? <Sparkles className="me-1.5 inline size-4 text-brand" /> : null}
              {m.text}
            </div>
          </div>
        ))}
        {pending ? (
          <div className="flex items-center gap-2 text-sm text-muted"><LoaderCircle className="size-4 animate-spin" />{labels.thinking}</div>
        ) : null}
        {error ? <p className="text-sm text-danger">{error}</p> : null}
        <div ref={end} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(text);
        }}
        className="flex gap-2 border-t border-line pt-3"
      >
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={labels.placeholder} className="input" dir="auto" />
        <button disabled={pending || !text.trim()} className="btn-primary inline-flex items-center gap-1.5" aria-label={labels.send}>
          <SendHorizontal className="size-4" />
        </button>
      </form>
    </div>
  );
}
