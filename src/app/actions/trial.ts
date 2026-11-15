"use server";

import { createClient } from "@/lib/supabase/server";

export type TrialState = { ok?: boolean; error?: "input" | "busy" | "failed" } | null;

/** The public "request a trial" form: stores the request for the Nuzul team, who send the personal link. */
export async function requestTrial(_: TrialState, fd: FormData): Promise<TrialState> {
  const v = (k: string) => String(fd.get(k) ?? "").trim();
  // a field people never see: anything that fills it is not a person
  if (v("website")) return { ok: true };
  let phone = v("phone").replace(/[^\d]/g, "");
  if (phone.length === 8) phone = `968${phone}`; // an Omani number written without the country code
  const email = v("email").toLowerCase();
  if (v("name").length < 2 || !/^\d{7,15}$/.test(phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "input" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("request_trial", { p_name: v("name"), p_phone: phone, p_email: email, p_company: v("company") });
  if (!error) return { ok: true };
  return { error: error.message.includes("RATE_LIMIT") ? "busy" : error.message.includes("INVALID_INPUT") ? "input" : "failed" };
}
