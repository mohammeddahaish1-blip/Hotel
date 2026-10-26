"use client";

import { useActionState, useState } from "react";
import { submitGuestFeedback } from "@/app/actions/feedback";

const TEXT = {
  ar: {
    intro: "يسعدنا سماع رأيك. اكتب اقتراحك أو شكواك وستصل مباشرة إلى إدارة الفندق.",
    suggestion: "💡 اقتراح",
    complaint: "😟 شكوى",
    rating: "تقييمك لإقامتك (اختياري)",
    message: "اكتب رسالتك",
    messagePh: "ما الذي أعجبك؟ وما الذي يمكن أن نحسّنه؟",
    room: "رقم الغرفة (اختياري)",
    name: "الاسم (اختياري)",
    contact: "الجوال أو البريد للتواصل (اختياري)",
    send: "إرسال",
    sending: "جارٍ الإرسال…",
    thanks: "شكراً لك! 🌷",
    thanksBody: "وصلت رسالتك إلى إدارة الفندق وسنهتم بها.",
    another: "إرسال رسالة أخرى",
    privacy: "لا نشارك بياناتك مع أي جهة. الاسم ووسيلة التواصل اختيارية.",
  },
  en: {
    intro: "We'd love to hear from you. Write your suggestion or complaint and it goes straight to the hotel management.",
    suggestion: "💡 Suggestion",
    complaint: "😟 Complaint",
    rating: "Rate your stay (optional)",
    message: "Your message",
    messagePh: "What did you like? What could we improve?",
    room: "Room number (optional)",
    name: "Name (optional)",
    contact: "Phone or email to reach you (optional)",
    send: "Send",
    sending: "Sending…",
    thanks: "Thank you! 🌷",
    thanksBody: "Your message has reached the hotel management and we will look into it.",
    another: "Send another message",
    privacy: "We never share your details. Name and contact are optional.",
  },
  ur: {
    intro: "ہمیں آپ کی رائے جاننے کی خوشی ہوگی۔ اپنی تجویز یا شکایت لکھیں، یہ براہِ راست ہوٹل انتظامیہ تک پہنچے گی۔",
    suggestion: "💡 تجویز",
    complaint: "😟 شکایت",
    rating: "اپنے قیام کی ریٹنگ دیں (اختیاری)",
    message: "اپنا پیغام لکھیں",
    messagePh: "آپ کو کیا اچھا لگا؟ ہم کیا بہتر کر سکتے ہیں؟",
    room: "کمرہ نمبر (اختیاری)",
    name: "نام (اختیاری)",
    contact: "رابطے کے لیے فون یا ای میل (اختیاری)",
    send: "بھیجیں",
    sending: "بھیجا جا رہا ہے…",
    thanks: "شکریہ! 🌷",
    thanksBody: "آپ کا پیغام ہوٹل انتظامیہ تک پہنچ گیا ہے، ہم اس پر توجہ دیں گے۔",
    another: "ایک اور پیغام بھیجیں",
    privacy: "ہم آپ کی معلومات کسی سے شیئر نہیں کرتے۔ نام اور رابطہ اختیاری ہیں۔",
  },
};

export function GuestFeedbackForm({ token, lang }: { token: string; lang: "ar" | "en" | "ur" }) {
  const x = TEXT[lang];
  const [state, action, pending] = useActionState(submitGuestFeedback.bind(null, token), null);
  const [kind, setKind] = useState<"suggestion" | "complaint">("suggestion");
  const [rating, setRating] = useState(0);

  if (state?.ok) {
    return (
      <div className="py-8 text-center">
        <div className="text-3xl font-bold text-brand">{x.thanks}</div>
        <p className="mt-3 text-muted">{x.thanksBody}</p>
        <button type="button" className="btn-ghost mt-6" onClick={() => window.location.reload()}>{x.another}</button>
      </div>
    );
  }

  return (
    <form action={action} className="space-y-4">
      <p className="text-sm text-muted">{x.intro}</p>
      <input type="hidden" name="lang" value={lang} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="rating" value={rating || ""} />
      <div className="grid grid-cols-2 gap-2">
        {(["suggestion", "complaint"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`rounded-xl border-2 px-3 py-3 text-base font-semibold transition ${
              kind === k ? (k === "complaint" ? "border-danger bg-danger-soft text-danger" : "border-brand bg-brand-soft text-brand") : "border-line text-muted"
            }`}
          >
            {x[k]}
          </button>
        ))}
      </div>
      <div>
        <div className="mb-1 text-sm font-semibold">{x.rating}</div>
        <div className="flex gap-1" dir="ltr">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n}/5`} onClick={() => setRating(n === rating ? 0 : n)} className="text-3xl leading-none">
              <span className={n <= rating ? "text-warn" : "text-line"}>★</span>
            </button>
          ))}
        </div>
      </div>
      <label className="block text-sm font-semibold">
        {x.message}
        <textarea name="message" required minLength={3} maxLength={2000} rows={5} placeholder={x.messagePh} className="input mt-1" />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block text-sm font-semibold">
          {x.room}
          <input name="room" maxLength={20} inputMode="numeric" className="input mt-1" />
        </label>
        <label className="block text-sm font-semibold">
          {x.name}
          <input name="name" maxLength={120} className="input mt-1" />
        </label>
      </div>
      <label className="block text-sm font-semibold">
        {x.contact}
        <input name="contact" maxLength={120} dir="ltr" className="input mt-1" />
      </label>
      {state?.error ? <div role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{state.error}</div> : null}
      <button type="submit" disabled={pending} className="btn-primary w-full py-3 text-base">{pending ? x.sending : x.send}</button>
      <p className="text-center text-xs text-muted">{x.privacy}</p>
    </form>
  );
}
