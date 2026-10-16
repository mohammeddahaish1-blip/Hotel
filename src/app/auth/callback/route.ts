import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next");
  // Only same-site relative paths, never an open redirect
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    // Typical cause: the email link was opened on another device/browser (no PKCE verifier).
    // The email is still confirmed by Supabase, so ask the user to sign in with their password.
    if (error) return NextResponse.redirect(`${origin}/login?notice=link`);
  }
  return NextResponse.redirect(`${origin}${target}`);
}
