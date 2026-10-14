"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { errorMessage } from "@/lib/errors";
import type { ActionResult } from "@/components/ActionForm";

export async function createTenant(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const supabase = await createClient();
  const { t } = await getDict();
  const { error } = await supabase.rpc("create_tenant", {
    p_tenant_name: String(fd.get("company")),
    p_property_name: String(fd.get("property")),
    p_owner_name: String(fd.get("owner")),
    p_property_kind: String(fd.get("kind")),
    p_municipality: String(fd.get("municipality")),
  });
  if (error) return { error: errorMessage(t, error) };
  redirect("/settings");
}
