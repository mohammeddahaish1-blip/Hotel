import Link from "next/link";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { GuestFeedbackForm } from "@/components/GuestFeedbackForm";

export const metadata: Metadata = { title: "رأيك يهمنا — Your feedback", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Public page opened from the QR code in rooms / at reception: no login.
export default async function GuestFeedbackPage({ params, searchParams }: PageProps<"/f/[token]">) {
  const { token } = await params;
  const lang = (await searchParams).lang === "en" ? "en" : "ar";
  let property: { name_ar: string; name_en: string | null } | undefined;
  if (UUID.test(token)) {
    const supabase = await createClient();
    const { data } = await supabase.rpc("feedback_property", { p_token: token });
    property = (data as { name_ar: string; name_en: string | null }[] | null)?.[0];
  }
  const name = property ? (lang === "en" && property.name_en ? property.name_en : property.name_ar) : null;

  return (
    <div dir={lang === "ar" ? "rtl" : "ltr"} lang={lang} className="min-h-screen bg-bg px-4 py-8">
      <div className="mx-auto max-w-md">
        <div className="mb-5 flex items-start justify-between gap-3">
          <div>
            <div className="brand-word text-4xl text-brand">نُزُل</div>
            {name ? <h1 className="mt-1 text-lg font-bold">{name}</h1> : null}
          </div>
          <Link href={`/f/${token}${lang === "ar" ? "?lang=en" : ""}`} className="btn-ghost btn-sm">{lang === "ar" ? "English" : "العربية"}</Link>
        </div>
        <div className="card p-5">
          {property ? (
            <GuestFeedbackForm token={token} lang={lang} />
          ) : (
            <p className="py-6 text-center text-muted">
              {lang === "ar" ? "الرابط غير صحيح. اطلب من الاستقبال الباركود الصحيح." : "This link is not valid. Please ask reception for the correct QR code."}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
