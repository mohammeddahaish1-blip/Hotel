import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { DEMO_EMAIL } from "@/lib/demo";

/**
 * A personal trial link sent by the Nuzul team. While it is valid it signs the visitor in as the shared demo
 * visitor: a manager of a showcase hotel with made-up data that is rebuilt every night. That account's
 * password is not a secret (the database keeps its email and password from being changed, and the showcase
 * cannot invite staff or reach our team); the link is what decides who is let in from the public page.
 */
const DEMO_PASSWORD = "Nuzul-Visitor-2026";

export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(token)) redirect("/?trial=expired#trial");
  const supabase = await createClient();
  const { data: valid } = await supabase.rpc("open_trial_link", { p_token: token });
  if (valid !== true) redirect("/?trial=expired#trial");
  const { error } = await supabase.auth.signInWithPassword({ email: DEMO_EMAIL, password: DEMO_PASSWORD });
  if (error) redirect("/?trial=unavailable#trial");
  (await cookies()).delete("property");
  redirect("/dashboard");
}
