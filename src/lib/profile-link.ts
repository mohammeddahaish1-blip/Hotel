import { hasRole, type Ctx } from "@/lib/auth";

/** Where a person's name links to: your own account, or (owner / manager) any colleague's profile. */
export function profileHref(ctx: Pick<Ctx, "userId" | "role" | "roles">, userId: string | null | undefined): string | null {
  if (!userId) return null;
  if (userId === ctx.userId) return "/profile";
  return hasRole(ctx, ["manager"]) ? `/profile/${userId}` : null;
}

/** The letter in a person's avatar circle; Arabic "ال" at the start is skipped ("المالك" → "م"). */
export function initial(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  const word = n.length > 3 && n.startsWith("ال") ? n.slice(2) : n;
  return word.slice(0, 1) || "؟";
}
