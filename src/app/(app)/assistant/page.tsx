import { requireFeature } from "@/lib/plan";
import { KeyRound } from "lucide-react";
import { redirect } from "next/navigation";
import { getCtx, hasRole } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { assistantEnabled } from "@/lib/assistant";
import { ask } from "@/app/actions/assistant";
import { AssistantChat } from "@/components/AssistantChat";
import { PageHeader } from "@/components/ui";

/** Owner/manager: ask questions about the hotel in plain language. */
export default async function AssistantPage() {
  const ctx = await getCtx();
  await requireFeature(ctx, "assistant");
  if (!hasRole(ctx, ["manager"])) redirect("/dashboard");
  const { t } = await getDict();
  return (
    <>
      <PageHeader title={t.ai_title} sub={t.ai_hint} />
      {assistantEnabled() ? (
        <AssistantChat
          ask={ask}
          suggestions={[t.ai_s1, t.ai_s2, t.ai_s3, t.ai_s4, t.ai_s5]}
          labels={{ placeholder: t.ai_placeholder, send: t.ai_send, thinking: t.ai_thinking }}
        />
      ) : (
        <div className="card flex items-start gap-3 text-sm">
          <KeyRound className="size-5 shrink-0 text-warn" />
          <p>{t.ai_setup}</p>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">{t.ai_privacy}</p>
    </>
  );
}
