"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEMO_EMAIL } from "@/lib/demo";

/**
 * The shared demo visitor: a manager of a showcase hotel with made-up data that is rebuilt every night.
 * The password is not a secret (the button below hands this account to anyone); the database keeps its
 * email and password from being changed, and the showcase cannot invite staff or reach our team.
 */
const DEMO_PASSWORD = "Nuzul-Visitor-2026";

export async function startDemo() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (error) redirect("/?demo=unavailable");
  (await cookies()).delete("property");
  redirect("/dashboard");
}
