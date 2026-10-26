import { requireArea } from "@/lib/auth";
import { getDict } from "@/lib/i18n/server";
import { feedbackUrl, qrSvg } from "@/lib/feedback-qr";
import { PrintButton } from "@/components/PrintButton";

// Printable card for rooms and reception (A4/A5: one card centred on the page)
export default async function FeedbackQrPage() {
  const ctx = await requireArea("feedback");
  const { t } = await getDict();
  const { data: prop } = await ctx.supabase.from("properties").select("feedback_token").eq("id", ctx.property.id).single();
  const url = await feedbackUrl(prop!.feedback_token);
  const svg = await qrSvg(url);
  return (
    <div className="space-y-4">
      <div className="no-print flex justify-end"><PrintButton label={t.fb_qr_print} /></div>
      <div className="mx-auto max-w-sm rounded-3xl border-2 border-brand bg-white p-8 text-center text-[#0d3b35]">
        <div className="brand-word text-5xl text-brand">نُزُل</div>
        <div className="mt-1 text-lg font-bold">{ctx.property.name_ar}</div>
        {ctx.property.name_en ? <div className="text-sm" dir="ltr">{ctx.property.name_en}</div> : null}
        <div className="mx-auto my-6 w-64" dangerouslySetInnerHTML={{ __html: svg }} />
        <div className="text-xl font-bold">رأيك يهمنا</div>
        <div className="mt-1 text-sm">امسح الباركود لإرسال اقتراح أو شكوى</div>
        <div className="mt-3 text-lg font-bold" dir="ltr">Your feedback matters</div>
        <div className="text-sm" dir="ltr">Scan to share a suggestion or complaint</div>
      </div>
    </div>
  );
}
