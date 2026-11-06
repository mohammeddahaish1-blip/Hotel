import Link from "next/link";
import { SearchX } from "lucide-react";
import { getDict } from "@/lib/i18n/server";
import { BackButton } from "@/components/BackButton";

/** Arabic (and English / Urdu) 404 for unknown links and for records that no longer exist. */
export default async function NotFound() {
  const { t } = await getDict();
  return (
    <main className="flex min-h-[60vh] items-center justify-center p-6">
      <div className="card max-w-md space-y-3 p-6 text-center">
        <SearchX className="mx-auto size-10 text-muted" aria-hidden />
        <h1 className="h1">{t.nf_title}</h1>
        <p className="text-sm text-muted">{t.nf_body}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link href="/" className="btn-primary">{t.nf_home}</Link>
          <BackButton label={t.back} />
        </div>
      </div>
    </main>
  );
}
