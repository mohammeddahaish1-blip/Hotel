import Link from "next/link";
import { AREAS, ROLE_ACCESS, requireArea, type Role } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { setPermissions } from "@/app/actions/settings";

// Owner grants or revokes sections per employee (enforced by private.has_role in the database).
export default async function PermissionsPage() {
  const ctx = await requireArea("settings");
  const { t } = await getDict();
  if (ctx.role !== "owner") {
    return (
      <>
        <PageHeader title={t.perm_title} />
        <Empty>{t.perm_owner_only}</Empty>
      </>
    );
  }
  const { data: members } = await ctx.supabase
    .from("memberships")
    .select("user_id, full_name, role, active, permissions")
    .eq("tenant_id", ctx.tenantId)
    .neq("role", "owner")
    .order("created_at");

  return (
    <>
      <PageHeader title={t.perm_title} sub={t.perm_intro} actions={<Link href="/settings" className="btn-ghost btn-sm">{t.back}</Link>} />
      {!members?.length ? (
        <Empty>{t.perm_none_staff}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {members.map((m) => {
            const role = m.role as Role;
            const custom = Array.isArray(m.permissions);
            const effective = custom ? (m.permissions as string[]) : AREAS.filter((a) => ROLE_ACCESS[a].includes(role));
            return (
              <ActionForm key={m.user_id} action={setPermissions} className="card space-y-3">
                <input type="hidden" name="user_id" value={m.user_id} />
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="font-bold">{m.full_name || m.user_id.slice(0, 8)}</div>
                    <div className="text-xs text-muted">{t[`role_${role}` as DictKey]}{m.active ? "" : ` · ${t.closed}`}</div>
                  </div>
                  <Badge tone={custom ? "warn" : "gray"}>{custom ? t.perm_custom : t.perm_defaults}</Badge>
                </div>
                <label className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2 text-sm">
                  <input type="checkbox" name="use_defaults" defaultChecked={!custom} />
                  {t.perm_defaults}
                </label>
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {AREAS.map((a) => (
                    <label key={a} className="flex items-start gap-2 rounded-lg border border-line px-2.5 py-2 text-sm">
                      <input type="checkbox" name="areas" value={a} defaultChecked={effective.includes(a)} className="mt-1" />
                      <span>
                        <span className="font-semibold">{t[`nav_${a}` as DictKey]}</span>
                        <span className="block text-xs text-muted">{t[`perm_desc_${a}` as DictKey]}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <SubmitButton className="btn-primary w-full">{t.save}</SubmitButton>
              </ActionForm>
            );
          })}
        </div>
      )}
    </>
  );
}
