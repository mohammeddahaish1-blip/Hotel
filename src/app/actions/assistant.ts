"use server";

import Anthropic from "@anthropic-ai/sdk";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { askAssistant, assistantEnabled, type ChatTurn } from "@/lib/assistant";

export async function ask(history: ChatTurn[], question: string): Promise<{ answer?: string; error?: string }> {
  const ctx = await getCtx();
  const { t, lang } = await getDict();
  if (!hasRole(ctx, ["manager"])) return { error: t.err_FORBIDDEN };
  if (!assistantEnabled()) return { error: t.ai_off };
  const q = question.trim();
  if (!q) return { error: t.ai_empty };
  try {
    return { answer: await askAssistant(ctx, history, q, lang) };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { error: t.ai_busy };
    if (e instanceof Anthropic.AuthenticationError) return { error: t.ai_off };
    if (e instanceof Anthropic.APIError) return { error: `${t.err_generic} (${e.status ?? ""})` };
    return { error: t.err_generic };
  }
}
