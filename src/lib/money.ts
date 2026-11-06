import { getDict } from "@/lib/i18n/server";
import { parseBaisa } from "@/lib/format";
import type { ActionResult } from "@/components/ActionForm";

/**
 * pos: required and above zero · min0: may be empty or zero, never negative · posOpt: may be empty, otherwise above zero.
 * Every money field is checked before anything is written, so "abc" or "-5" never turns into 0 or a database error.
 */
export type MoneyRule = "pos" | "min0" | "posOpt";

export async function moneyError(fd: FormData, rules: Record<string, MoneyRule>): Promise<ActionResult> {
  for (const [key, rule] of Object.entries(rules)) {
    const raw = fd.get(key);
    const text = typeof raw === "string" ? raw.trim() : "";
    if (text === "" && rule !== "pos") continue;
    const v = parseBaisa(text);
    const { t } = await getDict();
    if (text === "") return { error: t.money_required };
    if (v === null) return { error: t.money_invalid.replace("{v}", text.slice(0, 20)) };
    if (v < 0) return { error: t.money_negative };
    if (v === 0 && rule !== "min0") return { error: t.money_positive };
  }
  return null;
}
