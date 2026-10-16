"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function UpdatePasswordForm({ t }: { t: { title: string; label: string; save: string } }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const password = String(new FormData(e.currentTarget).get("password"));
    setPending(true);
    const { error } = await createClient().auth.updateUser({ password });
    setPending(false);
    if (error) return setError(error.message);
    router.replace("/");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="card w-full max-w-sm space-y-4 p-6">
      <h1 className="h1">{t.title}</h1>
      <label className="block">
        <span className="label">{t.label}</span>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" dir="ltr" className="input" />
      </label>
      {error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{error}</div> : null}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "…" : t.save}</button>
    </form>
  );
}
