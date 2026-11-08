import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Ctx } from "./auth";

/** Features a plan can include; everything else in the system is in every plan. */
export const FEATURES = [
  "messages", "automation", "payment_links", "contracts", "channels", "analytics", "import", "owners", "assistant", "multi_property",
] as const;
export type Feature = (typeof FEATURES)[number];

export type Plan = {
  isAdmin: boolean;
  code: string | null;
  name: string | null;
  nameEn: string | null;
  features: string[];
  status: "trial" | "active" | "past_due" | "suspended" | "cancelled" | null;
  trialEndsAt: string | null;
  periodEnd: string | null;
  maxUnits: number | null;
  maxProperties: number | null;
  price: number | null;
};

/** The current company's subscription (once per request) and whether the user is a system owner. */
export const getPlan = cache(async (ctx: Pick<Ctx, "supabase" | "tenantId">): Promise<Plan> => {
  const { data } = await ctx.supabase.rpc("my_subscription", { p_tenant: ctx.tenantId });
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    isAdmin: d.is_admin === true,
    code: (d.plan_code as string) ?? null,
    name: (d.plan_name as string) ?? null,
    nameEn: (d.plan_name_en as string) ?? null,
    features: Array.isArray(d.features) ? (d.features as string[]) : [],
    status: (d.status as Plan["status"]) ?? null,
    trialEndsAt: (d.trial_ends_at as string) ?? null,
    periodEnd: (d.current_period_end as string) ?? null,
    maxUnits: (d.max_units as number) ?? null,
    maxProperties: (d.max_properties as number) ?? null,
    price: (d.price as number) ?? null,
  };
});

/** A company without a subscription row (older data) keeps every feature. */
export function planHas(plan: Plan, f: Feature): boolean {
  return !plan.code || plan.features.includes(f);
}

/** Page guard: a feature outside the company's plan shows the plans page instead. */
export async function requireFeature(ctx: Pick<Ctx, "supabase" | "tenantId">, f: Feature): Promise<Plan> {
  const plan = await getPlan(ctx);
  if (!planHas(plan, f)) redirect(`/upgrade?f=${f}`);
  return plan;
}
