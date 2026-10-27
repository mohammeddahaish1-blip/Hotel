"use client";

import { useEffect, useRef, useState } from "react";
import { CreditCard, LoaderCircle, ScanLine, X } from "lucide-react";
import { bridgeRead, bridgeStatus, parseReaderText, SPECIMEN_MRZ, type CardRead } from "@/lib/card-reader";

export type CardReaderLabels = {
  read: string; detecting: string; insert: string; swipe: string; bad: string; bridgeError: string; demo: string; cancel: string;
};

type State = "idle" | "detecting" | "bridge" | "keyboard";

/**
 * "Read card from device" button. Uses the reader helper on this PC when it is running
 * (chip cards), otherwise listens for a keyboard-type reader typing the MRZ.
 */
export function CardReader({ labels, onRead, demo, autoStart }: {
  labels: CardReaderLabels;
  onRead: (r: CardRead) => void;
  demo?: boolean;
  autoStart?: boolean;
}) {
  const [state, setState] = useState<State>("idle");
  const [device, setDevice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const started = useRef(false);

  function done(r: CardRead) {
    setState("idle");
    setText("");
    setMessage(null);
    onRead(r);
  }

  async function start() {
    setMessage(null);
    setText("");
    setState("detecting");
    const name = await bridgeStatus();
    if (!name) return setState("keyboard");
    setDevice(name);
    setState("bridge");
    try {
      const r = await bridgeRead();
      if (r) return done(r);
      setMessage(labels.bad);
    } catch {
      setMessage(labels.bridgeError);
    }
    setState("keyboard");
  }

  useEffect(() => {
    if (autoStart && !started.current) {
      started.current = true;
      void start();
    }
    // start() only reads stable refs/props; run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStart]);

  useEffect(() => {
    if (state === "keyboard") box.current?.focus();
  }, [state]);

  // Keyboard readers type a line at a time: parse once input pauses
  function onType(v: string) {
    setText(v);
    setMessage(null);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (!v.trim()) return;
      const r = parseReaderText(v);
      if (r) done(r);
      else if (v.replace(/\s/g, "").length >= 60) setMessage(labels.bad);
    }, 400);
  }

  function close() {
    if (timer.current) clearTimeout(timer.current);
    setState("idle");
    setText("");
    setMessage(null);
  }

  if (state === "idle") {
    return (
      <button type="button" onClick={start} className="btn-primary inline-flex items-center gap-2">
        <CreditCard className="size-4 shrink-0" />{labels.read}
      </button>
    );
  }

  return (
    <div className="rounded-xl border border-brand/40 bg-surface p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-brand">
        {state === "keyboard" ? <ScanLine className="size-4 shrink-0" /> : <LoaderCircle className="size-4 shrink-0 animate-spin" />}
        <span className="flex-1">
          {state === "detecting" ? labels.detecting : state === "bridge" ? `${labels.insert} (${device})` : labels.swipe}
        </span>
        <button type="button" onClick={close} className="text-muted hover:text-ink" aria-label={labels.cancel}><X className="size-4" /></button>
      </div>
      {state === "keyboard" ? (
        <textarea
          ref={box}
          value={text}
          onChange={(e) => onType(e.target.value)}
          rows={3}
          dir="ltr"
          spellCheck={false}
          autoCapitalize="characters"
          autoComplete="off"
          className="input font-mono text-xs"
          placeholder="IDOMN…<<<"
        />
      ) : null}
      {message ? <p className="mt-2 text-xs text-warn">{message}</p> : null}
      {demo && state === "keyboard" ? (
        <button type="button" onClick={() => onType(SPECIMEN_MRZ)} className="btn-ghost btn-sm mt-2">{labels.demo}</button>
      ) : null}
    </div>
  );
}
