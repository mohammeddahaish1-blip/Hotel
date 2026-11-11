import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type Role = "owner" | "manager" | "reception" | "accountant" | "housekeeping" | "maintenance";

export type Property = {
  id: string;
  tenant_id: string;
  name_ar: string;
  name_en: string | null;
  timezone: string;
  currency: string;
  kind: string;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  vat_no: string | null;
  license_no: string | null;
};

export type Ctx = {
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  email: string;
  fullName: string;
  /** Free-text job title typed by the owner (falls back to the role name in the UI) */
  jobTitle: string | null;
  role: Role;
  /** null = the role's default areas; otherwise exactly the areas the owner granted */
  permissions: Area[] | null;
  /** Areas this user may open */
  areas: Area[];
  /** Database roles in effect (mirrors private.has_role) */
  roles: Role[];
  tenantId: string;
  /** Shops this person works in (seller / shop manager / renter); owner and managers manage every shop */
  shops: { id: string; access: "seller" | "manager" | "renter" }[];
  /** Set when this user is inside the hotel as Nuzul support: access ends at this moment */
  supportUntil: string | null;
  property: Property;
  properties: Property[];
};

/** Resolve the signed-in user, their membership and current property. */
export const getCtx = cache(async (): Promise<Ctx> => {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  if (!claims) redirect("/login");

  const loadMemberships = () =>
    supabase.from("memberships").select("tenant_id, role, full_name, permissions, job_title, support_until")
      .eq("user_id", claims.sub).eq("active", true)
      // a Nuzul support membership counts only while the hotel's grant runs
      .or(`support_until.is.null,support_until.gt."${new Date().toISOString()}"`);
  const loadProperties = () =>
    supabase
      .from("properties")
      .select("id, tenant_id, name_ar, name_en, timezone, currency, kind, phone, whatsapp, address, vat_no, license_no")
      .order("created_at");
  // One round trip for both: they don't depend on each other
  const shopsP = supabase.from("shop_members").select("shop_id, tenant_id, access").eq("user_id", claims.sub);
  let [{ data: memberships }, { data: properties }] = await Promise.all([loadMemberships(), loadProperties()]);
  if (!memberships || memberships.length === 0) {
    // First sign-in of invited staff: attach pending invitations for this email
    const { data: attached } = await supabase.rpc("accept_invitations");
    if (attached) [{ data: memberships }, { data: properties }] = await Promise.all([loadMemberships(), loadProperties()]);
  }
  if (!memberships || memberships.length === 0) redirect("/onboarding");
  if (!properties || properties.length === 0) redirect("/onboarding");

  const wanted = (await cookies()).get("property")?.value;
  const property = (properties.find((p) => p.id === wanted) ?? properties[0]) as Property;
  const membership = memberships.find((m) => m.tenant_id === property.tenant_id) ?? memberships[0];
  const role = membership.role as Role;
  const permissions = role === "owner" ? null : ((membership.permissions as Area[] | null) ?? null);
  const areas = permissions ?? AREAS.filter((a) => ROLE_ACCESS[a].includes(role));
  const roles: Role[] = permissions
    ? [...new Set(permissions.map((a) => AREA_ROLE[a]).filter((r): r is Role => r !== null))]
    : [role];

  const { data: shopRows } = await shopsP;
  const shops = (shopRows ?? [])
    .filter((r) => r.tenant_id === property.tenant_id)
    .map((r) => ({ id: r.shop_id as string, access: r.access as "seller" | "manager" | "renter" }));

  // NFR-02 (2FA for owners/managers) is switched off at the owner's request.
  // To re-enable: if ((role === "owner" || role === "manager") && claims.aal !== "aal2") redirect("/mfa");

  return {
    supabase,
    userId: claims.sub,
    email: (claims.email as string) ?? "",
    fullName: membership.full_name,
    jobTitle: (membership.job_title as string | null) ?? null,
    role,
    permissions,
    areas,
    roles,
    tenantId: property.tenant_id,
    shops,
    supportUntil: (membership.support_until as string | null) ?? null,
    property,
    properties: properties as Property[],
  };
});

export const AREAS = [
  "dashboard", "board", "calendar", "reservations", "guests", "housekeeping",
  "maintenance", "finance", "reports", "compliance", "settings", "audit", "feedback", "import",
] as const;
export type Area = (typeof AREAS)[number];

/** Default areas per role (used when the owner hasn't customised a member) */
export const ROLE_ACCESS: Record<Area, Role[]> = {
  dashboard: ["owner", "manager", "accountant"],
  board: ["owner", "manager", "reception", "accountant", "housekeeping", "maintenance"],
  calendar: ["owner", "manager", "reception"],
  reservations: ["owner", "manager", "reception", "accountant"],
  guests: ["owner", "manager", "reception"],
  housekeeping: ["owner", "manager", "reception", "housekeeping"],
  maintenance: ["owner", "manager", "reception", "housekeeping", "maintenance"],
  finance: ["owner", "manager", "reception", "accountant"],
  reports: ["owner", "manager", "accountant"],
  compliance: ["owner", "manager", "reception", "accountant"],
  settings: ["owner", "manager"],
  audit: ["owner", "manager", "accountant"],
  feedback: ["owner", "manager"],
  import: ["owner", "manager"],
};

/** Database rights an area brings when granted individually (mirrors private.area_role) */
export const AREA_ROLE: Record<Area, Role | null> = {
  dashboard: "accountant",
  board: null,
  calendar: "reception",
  reservations: "reception",
  guests: "reception",
  housekeeping: "housekeeping",
  maintenance: "maintenance",
  finance: "accountant",
  reports: "accountant",
  compliance: "reception",
  settings: "manager",
  audit: "accountant",
  feedback: null,
  import: null,
};

export function can(ctx: Pick<Ctx, "areas">, area: Area) {
  return ctx.areas.includes(area);
}

/** True when any of the given roles is in effect for this user (owner always qualifies) */
export function hasRole(ctx: Pick<Ctx, "role" | "roles">, roles: Role[]) {
  return ctx.role === "owner" || ctx.roles.some((r) => roles.includes(r));
}

export async function requireArea(area: Area): Promise<Ctx> {
  const ctx = await getCtx();
  if (!can(ctx, area)) redirect(ctx.areas.length ? `/denied?area=${area}` : homeFor(ctx));
  return ctx;
}

export function homeFor(ctx: Pick<Ctx, "areas"> & { shops?: Ctx["shops"] }): string {
  // someone who only works in a shop starts in their shop
  if (ctx.areas.length === 0 && ctx.shops?.length) return "/shops";
  const order: Area[] = ["dashboard", "board", "housekeeping", "maintenance", "reservations", "finance", "reports"];
  const first = order.find((a) => ctx.areas.includes(a)) ?? ctx.areas[0];
  return first ? `/${first}` : "/no-access";
}
