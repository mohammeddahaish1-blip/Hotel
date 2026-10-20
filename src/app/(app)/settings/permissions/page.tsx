import Link from "next/link";
import { AREAS, ROLE_ACCESS, requireArea, type Role } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import type { DictKey } from "@/lib/i18n/dict";
import { ActionForm, SubmitButton } from "@/components/ActionForm";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { setPermissions } from "@/app/actions/settings";

type Member = { user_id: string; full_name: string; role: Role; active: boolean; permissions: string[] | null };

// Owner grants or revokes sections per employee (enforced by private.has_role in the database).
// Master–detail: names on one side, the selected employee's sections on the other.
export default async function PermissionsPage({ searchParams }: PageProps<"/settings/permissions">) {
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
  const { data } = await ctx.supabase
    .from("memberships")
    .select("user_id, full_name, role, active, permissions")
    .eq("tenant_id", ctx.tenantId)
    .neq("role", "owner")
    .order("created_at");
  const members = (data ?? []) as Member[];
  const wanted = (await searchParams).u;
  const selected = members.find((m) => m.user_id === wanted) ?? members[0];

  const effectiveOf = (m: Member) => (Array.isArray(m.permissions) ? m.permissions : AREAS.filter((a) => ROLE_ACCESS[a].includes(m.role)));
  const nameOf = (m: Member) => m.full_name || m.user_id.slice(0, 8);

  return (
    <>
      <PageHeader title={t.perm_title} sub={t.perm_intro} />
      {!members.length ? (
        <Empty>{t.perm_none_staff}</Empty>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          {/* Employees */}
          <nav className="card p-2 lg:sticky lg:top-6 lg:self-start">
            <ul className="flex gap-1 overflow-x-auto lg:block lg:space-y-1">
              {members.map((m) => {
                const isSel = m.user_id === selected.user_id;
                const custom = Array.isArray(m.permissions);
                return (
                  <li key={m.user_id} className="shrink-0">
                    <Link
                      href={`/settings/permissions?u=${m.user_id}`}
                      scroll={false}
                      className={`flex items-center gap-3 rounded-xl px-3 py-2.5 ${isSel ? "bg-brand text-brand-ink" : "hover:bg-surface-2"}`}
                    >
                      <span
                        className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-sm font-bold ${isSel ? "bg-white/20" : "bg-brand-soft text-brand"}`}
                      >
                        {nameOf(m).trim().charAt(0)}
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">{nameOf(m)}</span>
                        <span className={`block text-xs ${isSel ? "opacity-80" : "text-muted"}`}>
                          {t[`role_${m.role}` as DictKey]} · {custom ? t.perm_custom : t.perm_defaults_short}
                          {m.active ? "" : ` · ${t.closed}`}
                        </span>
                      </span>
                      <span className={`ms-auto hidden text-xs lg:block ${isSel ? "opacity-80" : "text-muted"}`}>
                        {effectiveOf(m).length}/{AREAS.length}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          {/* Selected employee's sections */}
          <ActionForm key={selected.user_id} action={setPermissions} className="card space-y-4">
            <input type="hidden" name="user_id" value={selected.user_id} />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-lg font-bold text-brand">
                  {nameOf(selected).trim().charAt(0)}
                </span>
                <div>
                  <div className="text-lg font-bold">{nameOf(selected)}</div>
                  <div className="text-sm text-muted">{t[`role_${selected.role}` as DictKey]}</div>
                </div>
              </div>
              <Badge tone={Array.isArray(selected.permissions) ? "warn" : "gray"}>
                {Array.isArray(selected.permissions) ? t.perm_custom : t.perm_defaults}
              </Badge>
            </div>
            <label className="flex items-center gap-2 rounded-xl bg-surface-2 px-3 py-2.5 text-sm">
              <input type="checkbox" name="use_defaults" defaultChecked={!Array.isArray(selected.permissions)} />
              {t.perm_defaults}
            </label>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {AREAS.map((a) => (
                <label key={a} className="flex items-start gap-2 rounded-xl border border-line px-3 py-2.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-soft/50">
                  <input type="checkbox" name="areas" value={a} defaultChecked={effectiveOf(selected).includes(a)} className="mt-1" />
                  <span>
                    <span className="font-semibold">{t[`nav_${a}` as DictKey]}</span>
                    <span className="block text-xs text-muted">{t[`perm_desc_${a}` as DictKey]}</span>
                  </span>
                </label>
              ))}
            </div>
            <SubmitButton className="btn-primary w-full sm:w-auto sm:px-10">{t.save}</SubmitButton>
          </ActionForm>
        </div>
      )}
    </>
  );
}
