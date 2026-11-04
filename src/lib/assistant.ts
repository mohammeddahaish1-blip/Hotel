import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Ctx } from "./auth";
import { hasRole } from "./auth";
import { addDays, parseRange, todayIn } from "./format";

/**
 * "Ask your hotel" assistant for the owner and managers.
 * Claude answers from read-only tools that query the database as the signed-in user,
 * so it can only see what that person may see (row-level security applies).
 */
const MODEL = "claude-opus-5-5";
const MAX_STEPS = 8;

export const assistantEnabled = () => Boolean(process.env.ANTHROPIC_API_KEY);

const omr = (baisa: number | null | undefined) => Math.round(Number(baisa ?? 0)) / 1000;
const isDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const range = { from: { type: "string", description: "First day, YYYY-MM-DD" }, to: { type: "string", description: "Last day (inclusive), YYYY-MM-DD" } };

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "occupancy",
    description: "Occupancy, rooms sold, room revenue (OMR), ADR and RevPAR for a date range at the current property. Use for occupancy and room revenue questions.",
    input_schema: { type: "object", properties: range, required: ["from", "to"], additionalProperties: false },
    strict: true,
  },
  {
    name: "income",
    description: "Money actually received (payments, OMR) per day and in total for a date range.",
    input_schema: { type: "object", properties: range, required: ["from", "to"], additionalProperties: false },
    strict: true,
  },
  {
    name: "expenses",
    description: "Expenses (OMR) for a date range, totals by category, excluding archived ones.",
    input_schema: { type: "object", properties: range, required: ["from", "to"], additionalProperties: false },
    strict: true,
  },
  {
    name: "receivables",
    description: "Guests who owe money now: balance (OMR), how many days overdue, unit and booking code. Use for unpaid / late payment questions.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "bookings",
    description: "Bookings whose stay overlaps a date range: code, unit, guest name, arrival, departure, status, source (direct, booking, airbnb...). Use for arrivals, departures and who is staying.",
    input_schema: {
      type: "object",
      properties: { ...range, status: { type: "string", enum: ["any", "tentative", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"] } },
      required: ["from", "to", "status"],
      additionalProperties: false,
    },
    strict: true,
  },
  {
    name: "units_now",
    description: "Every unit's status today (available, occupied, dirty, maintenance, out of service...) with counts.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "today_overview",
    description: "Today's dashboard: arrivals, departures, in-house, cash, month-to-date revenue and expenses, and the open alerts.",
    input_schema: { type: "object", properties: {}, required: [], additionalProperties: false },
    strict: true,
  },
  {
    name: "staff_performance",
    description: "Per employee for a date range: bookings created, check-ins, check-outs, payments taken, cleaning tasks done.",
    input_schema: { type: "object", properties: range, required: ["from", "to"], additionalProperties: false },
    strict: true,
  },
];

async function runTool(ctx: Ctx, name: string, input: Record<string, unknown>): Promise<unknown> {
  const db = ctx.supabase;
  const p = ctx.property.id;
  const from = isDate(input.from) ? input.from : todayIn(ctx.property.timezone);
  const to = isDate(input.to) ? input.to : from;
  if (to < from || to > addDays(from, 400)) return { error: "date range must be 1 to 400 days" };
  const toExcl = addDays(to, 1);
  switch (name) {
    case "occupancy": {
      const { data, error } = await db.rpc("occupancy_report", { p_property: p, p_from: from, p_to: toExcl });
      if (error) return { error: error.message };
      const rows = (data ?? []) as { day: string; units: number; sold: number; room_revenue: number }[];
      const units = rows.reduce((a, r) => a + r.units, 0);
      const sold = rows.reduce((a, r) => a + r.sold, 0);
      const revenue = rows.reduce((a, r) => a + Number(r.room_revenue), 0);
      return {
        from, to, room_nights_available: units, room_nights_sold: sold,
        occupancy_pct: units ? Math.round((sold / units) * 1000) / 10 : 0,
        room_revenue_omr: omr(revenue), adr_omr: sold ? omr(revenue / sold) : 0, revpar_omr: units ? omr(revenue / units) : 0,
        daily: rows.length <= 62 ? rows.map((r) => ({ day: r.day, sold: r.sold, units: r.units, revenue_omr: omr(r.room_revenue) })) : undefined,
      };
    }
    case "income": {
      const { data, error } = await db.rpc("daily_income", { p_property: p, p_from: from, p_to: toExcl });
      if (error) return { error: error.message };
      const rows = (data ?? []) as { day: string; amount: number }[];
      return { from, to, total_omr: omr(rows.reduce((a, r) => a + Number(r.amount), 0)), daily: rows.length <= 62 ? rows.map((r) => ({ day: r.day, omr: omr(r.amount) })) : undefined };
    }
    case "expenses": {
      const { data, error } = await db.from("expenses").select("category, amount").eq("property_id", p).is("archived_at", null).gte("expense_date", from).lte("expense_date", to);
      if (error) return { error: error.message };
      const by = new Map<string, number>();
      for (const e of data ?? []) by.set(e.category as string, (by.get(e.category as string) ?? 0) + Number(e.amount));
      return { from, to, total_omr: omr([...by.values()].reduce((a, b) => a + b, 0)), by_category_omr: Object.fromEntries([...by].map(([k, v]) => [k, omr(v)])) };
    }
    case "receivables": {
      const { data, error } = await db.rpc("aging_report", { p_property: p });
      if (error) return { error: error.message };
      const rows = (data ?? []) as { code: string; guest_name: string; unit: string; balance: number; age_days: number; bucket: string }[];
      return {
        total_omr: omr(rows.reduce((a, r) => a + Number(r.balance), 0)), count: rows.length,
        guests: rows.slice(0, 40).map((r) => ({ code: r.code, guest: r.guest_name, unit: r.unit, balance_omr: omr(r.balance), days: r.age_days, bucket: r.bucket })),
      };
    }
    case "bookings": {
      let q = db.from("reservations").select("code, stay, status, source, kind, units(number), guests(full_name)").eq("property_id", p).overlaps("stay", `[${from},${toExcl})`).order("stay").limit(80);
      if (typeof input.status === "string" && input.status !== "any") q = q.eq("status", input.status);
      const { data, error } = await q;
      if (error) return { error: error.message };
      return (data ?? []).map((r) => {
        const s = parseRange(r.stay as string);
        return { code: r.code, unit: (r.units as unknown as { number: string } | null)?.number, guest: (r.guests as unknown as { full_name: string } | null)?.full_name, arrival: s.from, departure: s.to, status: r.status, source: r.source, kind: r.kind };
      });
    }
    case "units_now": {
      const { data, error } = await db.rpc("unit_board", { p_property: p });
      if (error) return { error: error.message };
      const rows = (data ?? []) as { number: string; status: string; type_name: string }[];
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
      return { counts, units: rows.map((r) => ({ unit: r.number, status: r.status, type: r.type_name })) };
    }
    case "today_overview": {
      const [{ data: dash }, { data: alerts }] = await Promise.all([
        db.rpc("owner_dashboard", { p_property: p }),
        db.rpc("alerts", { p_property: p }),
      ]);
      return { dashboard_amounts_in_baisa: dash, alerts: ((alerts ?? []) as { kind: string; unit: string | null; info: string | null }[]).slice(0, 40) };
    }
    case "staff_performance": {
      if (!hasRole(ctx, ["manager"])) return { error: "not allowed" };
      const { data, error } = await db.rpc("staff_performance", { p_property: p, p_from: from, p_to: toExcl });
      if (error) return { error: error.message };
      return data;
    }
    default:
      return { error: `unknown tool ${name}` };
  }
}

export type ChatTurn = { role: "user" | "assistant"; text: string };

/** One question (with the earlier text turns) → the assistant's answer. */
export async function askAssistant(ctx: Ctx, history: ChatTurn[], question: string, lang: string): Promise<string> {
  const client = new Anthropic();
  const today = todayIn(ctx.property.timezone);
  const system = [
    `You are the analytics assistant inside Nuzul, a hotel management system used in Oman, helping the ${ctx.role === "owner" ? "owner" : "manager"} of "${ctx.property.name_ar}".`,
    "Answer only from the tools; never guess numbers. If the tools cannot answer, say what is missing.",
    "Money is in Omani rial (OMR) with 3 decimals. Keep answers short and practical: the figure first, then one or two lines of context or a suggestion.",
    `Reply in ${lang === "en" ? "English" : lang === "ur" ? "Urdu" : "Arabic"}. Today's date at the property is ${today} (time zone ${ctx.property.timezone}). Weeks start on Sunday.`,
  ].join("\n");
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.text.slice(0, 4000) })),
    { role: "user", content: question.slice(0, 2000) },
  ];

  for (let step = 0; step < MAX_STEPS; step++) {
    const response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium" },
      system,
      tools: TOOLS,
      messages,
    });
    if (response.stop_reason === "refusal") return lang === "en" ? "I can't help with that request." : "لا أستطيع المساعدة في هذا الطلب.";
    const toolUses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      if (response.stop_reason === "pause_turn") {
        messages.push({ role: "assistant", content: response.content });
        continue;
      }
      return response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
    }
    messages.push({ role: "assistant", content: response.content });
    const results = await Promise.all(
      toolUses.map(async (tu): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const out = await runTool(ctx, tu.name, (tu.input ?? {}) as Record<string, unknown>);
          return { type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(out).slice(0, 60000) };
        } catch (e) {
          return { type: "tool_result", tool_use_id: tu.id, content: `error: ${(e as Error).message}`, is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return lang === "en" ? "That needed too many steps; try a narrower question." : "احتاج السؤال خطوات كثيرة، جرّب سؤالاً أدق.";
}
