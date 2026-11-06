import { redirect } from "next/navigation";

/** The activity feed and the audit log are one page now: /audit. Old links keep working. */
export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const sp = await searchParams;
  redirect(typeof sp.u === "string" && /^[0-9a-f-]{36}$/.test(sp.u) ? `/audit?actor=${sp.u}` : "/audit");
}
