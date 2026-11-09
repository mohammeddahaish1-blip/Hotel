"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

/** Signs out on this device only (the shared demo account stays signed in for other visitors). */
export function SignOut({ label, to = "/login" }: { label: string; to?: string }) {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn-ghost btn-sm"
      onClick={async () => {
        await createClient().auth.signOut({ scope: "local" });
        router.replace(to);
        router.refresh();
      }}
    >
      {label}
    </button>
  );
}
