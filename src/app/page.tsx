import { redirect } from "next/navigation";
import { getCtx, homeFor } from "@/lib/auth";

export default async function Home() {
  const ctx = await getCtx();
  redirect(homeFor(ctx.role));
}
