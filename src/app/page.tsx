import type { Viewport } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowDown, CalendarRange, Check, ClipboardCheck, FileText, KeyRound, LifeBuoy, MessageCircle, Receipt, ShieldCheck, Wrench,
} from "lucide-react";
import { headers } from "next/headers";
import { getCtx, homeFor } from "@/lib/auth";
import { amount, CUR, currencyForCountry, type Currency } from "@/lib/currency";
import { Money } from "@/components/CurrencySign";
import { createClient } from "@/lib/supabase/server";
import { getDict } from "@/lib/i18n/server";
import { LangToggle } from "@/components/LangToggle";
import { Reveal } from "@/components/landing/Reveal";
import { TrialForm } from "@/components/landing/TrialForm";
import { Automation, HeroStage, Journey, Pocket, Replaces, Solutions } from "@/components/landing/Showcase";

type PlanRow = {
  code: string; name_ar: string; name_en: string | null; monthly_price: number; max_units: number | null; max_properties: number | null; features: string[];
  offer_active: boolean; offer_ends_on: string | null; offer_label: string | null;
};
type PriceRow = { plan_code: string; currency: Currency; monthly: number; yearly: number; offer_monthly: number | null; offer_yearly: number | null };

const COPY = {
  ar: {
    login: "تسجيل الدخول",
    title: "أدِر فندقك وشققك الفندقية من مكان واحد",
    sub: "الحجوزات والاستقبال، التنظيف والصيانة، الفواتير والرسوم الحكومية، والتقارير — من الكمبيوتر أو الآيباد أو الجوال.",
    badge: "نظام عربي صُنع في عُمان",
    demo: "اطلب تجربة النظام",
    demoNote: "نرسل لك رابطاً خاصاً يفتح فندقاً تجريبياً ببيانات وهمية",
    nav: ["المزايا", "يومك في نُزُل", "الباقات", "أسئلة"],
    mock: { caption: "صورة توضيحية بأرقام وهمية", occ: "الإشغال الآن", of: "18 من 23 وحدة", money: "دخل اليوم", week: "آخر 7 أيام", arrivals: "الواصلون اليوم", checkin: "تسجيل دخول", in: "دخل", ready: "الوحدة 204 جاهزة", paid: "دفعة مستلمة", guests: ["سالم الحارثي", "نورة المعمري"] },
    stats: [["4", "لغات للواجهة: العربية، الإنجليزية، الأردية، البنغالية"], ["3", "أجهزة: الكمبيوتر، الآيباد، الجوال"], ["0", "برامج للتثبيت، يعمل من المتصفح"]],
    dayTitle: "يوم كامل في نُزُل",
    daySub: "من أول نزيل يصل حتى إقفال الصندوق، كل خطوة في مكانها.",
    day: [
      ["الصباح", "لوحة واحدة تقول لك من يصل ومن يغادر", "الواصلون والمغادرون والتنبيهات أمامك، وتسجيل الدخول بضغطة."],
      ["الظهر", "العامل ينظف ويصوّر، والاستقبال يعرف فوراً", "حالة الغرفة تتغير لحظياً، والمدير يرى وقت البدء والانتهاء والصورة."],
      ["العصر", "الدفعات والفواتير بلا حساب يدوي", "الرسوم والضريبة تُحسب تلقائياً، وإثبات التحويل مرفق مع الدفعة."],
      ["آخر اليوم", "إقفال الصندوق في ثلاث خطوات", "تعدّ النقد، يقارنه النظام بالمفروض، وتقفل ورديتك."],
    ],
    trialTitle: "اطلب تجربة النظام",
    trialSub: "اكتب بياناتك ونرسل لك رابطاً خاصاً على واتساب أو بريدك. الرابط يفتح فندقاً تجريبياً كاملاً لمدة 7 أيام، بدون تسجيل ولا بطاقة دفع.",
    trialPoints: ["فندق تجريبي ببيانات وهمية", "تجرّب كل الأقسام بنفسك", "بدون أي التزام"],
    form: { name: "الاسم", company: "اسم الفندق أو الشركة (اختياري)", phone: "رقم الجوال", email: "البريد الإلكتروني", send: "أرسل الطلب", sending: "جارٍ الإرسال…", doneTitle: "وصلنا طلبك", doneBody: "سنرسل لك رابط التجربة على واتساب أو بريدك في أقرب وقت.", errInput: "تأكد من الاسم ورقم الجوال والبريد الإلكتروني.", errBusy: "الطلبات كثيرة الآن، حاول بعد قليل.", errFailed: "تعذّر إرسال الطلب، حاول مرة أخرى.", privacy: "نستخدم رقمك وبريدك لإرسال رابط التجربة والتواصل معك بخصوصه فقط." },
    expired: "رابط التجربة انتهت مدته أو غير صحيح. اطلب رابطاً جديداً من هنا.",
    trial: "ابدأ شهرك المجاني",
    trialNote: "الشهر الأول مجاناً على الباقة الشاملة، بدون بطاقة دفع",
    unavailable: "التجربة غير متاحة الآن، حاول بعد قليل.",
    featuresTitle: "كل ما يحتاجه يومك في الفندق",
    features: [
      [CalendarRange, "الوحدات والتقويم", "حالة كل غرفة وشقة لحظة بلحظة، والحجز مباشرة من التقويم دون حجز مزدوج."],
      [KeyRound, "الاستقبال والنزلاء", "تسجيل الوصول بقراءة البطاقة المدنية أو الجواز، وسجل كامل لكل نزيل."],
      [Receipt, "الفواتير والرسوم", "رسوم السياحة والبلدية وضريبة القيمة المضافة تُحسب تلقائياً، وسندات قبض مرقّمة."],
      [FileText, "الإيجار الشهري والعقود", "عقود الشقق وجدول الدفعات والشيكات المؤجلة، مع تنبيه قبل انتهاء العقد."],
      [Wrench, "التنظيف والصيانة", "مهام تنظيف لكل غرفة، وبلاغات أعطال تمنع حجز الوحدة حتى تُصلح."],
      [MessageCircle, "القنوات وواتساب", "ربط تقويم Booking وAirbnb، ورسائل واتساب جاهزة للتأكيد والتذكير."],
      [ClipboardCheck, "التقارير والإقفال اليومي", "الإيراد والإشغال والمصروفات، وإقفال نهاية اليوم بلا حجوزات معلّقة."],
      [ShieldCheck, "الصلاحيات وسجل العمليات", "لكل موظف ما يخصه فقط، وكل تعديل مسجّل باسم من قام به ومتى."],
      [LifeBuoy, "دعم يحترم خصوصيتك", "لا يدخل فريق نُزُل نظامك إلا بإذنك ولمدة تحددها، وترى كل ما فعله."],
    ] as const,
    plansTitle: "باقات واضحة، والشهر الأول مجاناً",
    plansSub: "تبدأ كل شركة بشهر مجاني كامل على الباقة الشاملة، ثم تختار الباقة التي تناسبها. لا يُخصم شيء تلقائياً.",
    perMonth: "شهرياً",
    perYear: "سنوياً",
    billMonth: "شهري",
    billYear: "سنوي",
    offerLabel: "عرض لفترة محدودة",
    was: "بدلاً من",
    offerOff: (n: string, y: boolean) => `خصم ${n} ${y ? "كل سنة" : "كل شهر"}`,
    saveYear: (n: string) => `وفّر ${n} في السنة`,
    until: "حتى",
    inCur: (c: string) => `الأسعار بعملة بلدك: ${c}`,
    units: (n: number | null) => (n ? `حتى ${n} وحدة` : "وحدات غير محدودة"),
    props: (n: number | null) => (n == null ? "عقارات غير محدودة" : n === 1 ? "عقار واحد" : `حتى ${n} عقار`),
    core: "كل أساسيات التشغيل: الحجوزات، الاستقبال، الفواتير، التنظيف، الصيانة، التقارير",
    choose: "ابدأ مجاناً",
    faqTitle: "أسئلة شائعة",
    faq: [
      ["هل أحتاج لتثبيت أي برنامج؟", "لا. يعمل نُزُل من المتصفح على الكمبيوتر والآيباد والجوال، ويمكن إضافته للشاشة الرئيسية كتطبيق."],
      ["هل بياناتي آمنة؟", "بيانات كل شركة معزولة تماماً، وكل عملية مسجّلة باسم من قام بها، ولا يصل فريقنا لبياناتك إلا بإذن منك ولوقت محدد."],
      ["ماذا يحدث بعد الشهر المجاني؟", "تختار الباقة المناسبة وتدفع شهرياً. إن لم تشترك لا يُخصم منك شيء."],
      ["هل يناسب الشقق الفندقية والإيجار الشهري؟", "نعم: عقود شهرية، جدول دفعات، شيكات مؤجلة، وكشوف لملاك الوحدات."],
    ] as const,
    footer: "نظام عربي لإدارة الفنادق والشقق الفندقية",
  },
  en: {
    login: "Sign in",
    title: "Run your hotel and serviced apartments from one place",
    sub: "Bookings and front desk, housekeeping and maintenance, invoices and government fees, and reports — on a computer, iPad or phone.",
    badge: "Arabic-first, made in Oman",
    demo: "Request a trial",
    demoNote: "We send you a personal link to a sample hotel with made-up data",
    nav: ["Features", "Your day", "Plans", "Questions"],
    mock: { caption: "Illustration with made-up numbers", occ: "Occupancy now", of: "18 of 23 units", money: "Income today", week: "Last 7 days", arrivals: "Arriving today", checkin: "Check in", in: "In house", ready: "Unit 204 is ready", paid: "Payment received", guests: ["Salim Al Harthi", "Noura Al Maamari"] },
    stats: [["4", "interface languages: Arabic, English, Urdu, Bengali"], ["3", "devices: computer, iPad, phone"], ["0", "programs to install, it runs in the browser"]],
    dayTitle: "A full day in Nuzul",
    daySub: "From the first arrival to closing the cash drawer, every step has its place.",
    day: [
      ["Morning", "One board tells you who arrives and who leaves", "Arrivals, departures and alerts in front of you, and check-in in one press."],
      ["Midday", "The cleaner cleans and takes a photo, the desk knows at once", "The room's status changes live, and the manager sees start time, finish time and the photo."],
      ["Afternoon", "Payments and invoices with no hand calculation", "Fees and VAT are worked out for you, and the transfer proof is attached to the payment."],
      ["End of day", "Close the cash drawer in three steps", "You count the cash, the system compares it with what should be there, and you close your shift."],
    ],
    trialTitle: "Request a trial",
    trialSub: "Leave your details and we send a personal link by WhatsApp or e-mail. It opens a complete sample hotel for 7 days, with no sign-up and no card.",
    trialPoints: ["A sample hotel with made-up data", "Try every section yourself", "No commitment"],
    form: { name: "Name", company: "Hotel or company (optional)", phone: "Mobile number", email: "E-mail", send: "Send request", sending: "Sending…", doneTitle: "We have your request", doneBody: "We will send your trial link by WhatsApp or e-mail shortly.", errInput: "Please check the name, mobile number and e-mail.", errBusy: "Too many requests right now, please try again shortly.", errFailed: "The request could not be sent, please try again.", privacy: "We use your number and e-mail only to send the trial link and to contact you about it." },
    expired: "This trial link has expired or is not valid. Request a new one here.",
    trial: "Start your free month",
    trialNote: "First month free on the full plan, no card needed",
    unavailable: "The trial is not available right now, please try again shortly.",
    featuresTitle: "Everything your hotel's day needs",
    features: [
      [CalendarRange, "Units and calendar", "Every room and apartment's status in real time, and booking straight from the calendar with no double bookings."],
      [KeyRound, "Front desk and guests", "Check-in by reading the civil ID or passport, and a full history for every guest."],
      [Receipt, "Invoices and fees", "Tourism levy, municipality fee and VAT worked out for you, with numbered receipts."],
      [FileText, "Monthly rentals and contracts", "Apartment contracts, payment schedules and post-dated cheques, with a reminder before a contract ends."],
      [Wrench, "Housekeeping and maintenance", "Cleaning tasks per room, and fault reports that keep a unit off sale until it is fixed."],
      [MessageCircle, "Channels and WhatsApp", "Booking and Airbnb calendar sync, and ready WhatsApp messages for confirmations and reminders."],
      [ClipboardCheck, "Reports and daily close", "Revenue, occupancy and expenses, and an end-of-day close with nothing left pending."],
      [ShieldCheck, "Permissions and activity log", "Each employee sees only their part, and every change is logged with who did it and when."],
      [LifeBuoy, "Support that respects your privacy", "The Nuzul team only enters your system with your permission, for a time you set, and you see what they did."],
    ] as const,
    plansTitle: "Clear plans, first month free",
    plansSub: "Every company starts with a full free month on the complete plan, then picks the plan that fits. Nothing is charged automatically.",
    perMonth: "per month",
    perYear: "per year",
    billMonth: "Monthly",
    billYear: "Yearly",
    offerLabel: "Limited-time offer",
    was: "was",
    offerOff: (n: string, y: boolean) => `${n} off every ${y ? "year" : "month"}`,
    saveYear: (n: string) => `Save ${n} a year`,
    until: "until",
    inCur: (c: string) => `Prices in ${c}`,
    units: (n: number | null) => (n ? `Up to ${n} units` : "Unlimited units"),
    props: (n: number | null) => (n == null ? "Unlimited properties" : n === 1 ? "One property" : `Up to ${n} properties`),
    core: "All the essentials: bookings, front desk, invoices, housekeeping, maintenance, reports",
    choose: "Start free",
    faqTitle: "Questions",
    faq: [
      ["Do I need to install anything?", "No. Nuzul runs in the browser on a computer, iPad or phone, and can be added to the home screen like an app."],
      ["Is my data safe?", "Each company's data is fully separated, every action is logged with who did it, and our team reaches your data only with your permission and for a set time."],
      ["What happens after the free month?", "You choose a plan and pay monthly. If you don't subscribe, nothing is charged."],
      ["Does it suit serviced apartments and monthly rentals?", "Yes: monthly contracts, payment schedules, post-dated cheques and statements for unit owners."],
    ] as const,
    footer: "Arabic-first hotel and serviced-apartment management",
  },
};

const FEATURE_NAMES: Record<string, [string, string]> = {
  messages: ["رسائل واتساب للنزلاء", "WhatsApp guest messages"], automation: ["الأتمتة", "Automation"],
  payment_links: ["روابط الدفع", "Payment links"], contracts: ["العقود الإلكترونية والتوقيع", "E-contracts and signing"],
  channels: ["ربط القنوات (Booking / Airbnb)", "Channel sync (Booking / Airbnb)"], analytics: ["التحليلات", "Analytics"],
  import: ["استيراد البيانات", "Data import"], owners: ["كشوف ملاك الوحدات", "Unit owner statements"],
  assistant: ["المساعد الذكي", "AI assistant"], multi_property: ["تعدد العقارات", "Multiple properties"],
};


// the page is light, so the phone's browser bar is light with it (the app keeps the brand colour)
export const viewport: Viewport = { themeColor: "#f6f8f6" };

/** Visitors see the product page; signed-in staff go straight to their home page. */
export default async function Home({ searchParams }: PageProps<"/">) {
  const supabase = await createClient();
  const { data: claims } = await supabase.auth.getClaims();
  if (claims?.claims) {
    const ctx = await getCtx();
    redirect(homeFor(ctx));
  }
  const { lang } = await getDict();
  const en = lang === "en" || lang === "bn";   // Bengali visitors read the English page
  const c = en ? COPY.en : COPY.ar;
  const sp = await searchParams;
  const [{ data }, { data: priceRows }, h] = await Promise.all([
    supabase.from("plans").select("code, name_ar, name_en, monthly_price, max_units, max_properties, features, offer_active, offer_ends_on, offer_label").eq("active", true).order("sort"),
    supabase.from("plan_prices").select("plan_code, currency, monthly, yearly, offer_monthly, offer_yearly"),
    headers(),
  ]);
  const plans = (data ?? []) as PlanRow[];
  // prices in the visitor's own currency: Saudi riyals from Saudi Arabia, dirhams from the UAE, Omani rials otherwise
  const cur = currencyForCountry(h.get("x-vercel-ip-country"));
  const yearly = sp.bill === "year";
  const today = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  const priceOf = (p: PlanRow) => {
    const rows = (priceRows ?? []) as PriceRow[];
    const row = rows.find((r) => r.plan_code === p.code && r.currency === cur);
    const c = row ? cur : "OMR";
    const r = row ?? rows.find((x) => x.plan_code === p.code && x.currency === "OMR");
    const list = r ? (yearly ? r.yearly : r.monthly) : p.monthly_price * (yearly ? 10 : 1);
    const offerOn = p.offer_active && (!p.offer_ends_on || p.offer_ends_on >= today);
    const offer = offerOn && r ? (yearly ? r.offer_yearly : r.offer_monthly) : null;
    const twelve = r ? r.monthly * 12 : 0;
    return { c, list, now: offer != null && offer < list ? offer : list, was: offer != null && offer < list ? list : null, save: yearly && r && twelve > r.yearly ? twelve - r.yearly : 0 };
  };
  const fmt = (minor: number, c: Currency) => amount(minor, c, "en-US");
  const notice = sp.trial === "expired" ? c.expired : sp.trial === "unavailable" ? c.unavailable : null;
  const anchors = ["#journey", "#features", "#day", "#plans", "#faq"];
  const hero = en
    ? { title: "Know what is happening in your hotel, minute by minute", caption: "A real screen from the system, with sample data", nav: ["Journey", "What it does", "No chasing", "Plans", "Questions"] }
    : { title: "اعرف ما يجري في فندقك، لحظة بلحظة", caption: "شاشة حقيقية من النظام ببيانات تجريبية", nav: ["المحطات", "ماذا يفعل", "بلا متابعة", "الباقات", "أسئلة"] };

  return (
    <div className="lp-root min-h-screen overflow-x-clip bg-[#f6f8f6] text-[#1c2321]">
      <noscript><style>{".lp-reveal{opacity:1;transform:none}"}</style></noscript>
      <header className="sticky top-0 z-30 border-b border-black/5 bg-[#f6f8f6]/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 lg:px-8">
          <span className="brand-word text-3xl text-brand sm:text-4xl">نُزُل</span>
          <nav className="ms-6 hidden gap-1 text-sm font-semibold text-[#4d5753] md:flex" aria-label={c.featuresTitle}>
            {hero.nav.map((label, i) => <a key={label} href={anchors[i]} className="rounded-full px-3 py-2 hover:bg-white hover:text-brand">{label}</a>)}
          </nav>
          <div className="ms-auto flex items-center gap-2">
            <LangToggle current={lang} className="min-h-11" />
            <Link href="/login" className="btn-ghost btn-sm tap">{c.login}</Link>
            <a href="#trial" className="btn-primary btn-sm hidden sm:inline-flex">{c.demo}</a>
          </div>
        </div>
      </header>

      <main>
        <section className="relative">
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="lp-blob absolute -top-24 start-[-10%] size-[28rem] rounded-full bg-[#bfe3da] opacity-60 blur-3xl" />
            <div className="lp-blob-2 absolute top-40 end-[-8%] size-[24rem] rounded-full bg-[#f3e2b8] opacity-50 blur-3xl" />
          </div>
          <div className="relative mx-auto grid max-w-6xl items-center gap-6 px-4 pb-10 pt-8 sm:gap-14 sm:pb-20 sm:pt-12 lg:grid-cols-2 lg:px-8 lg:pb-28 lg:pt-20">
            <div>
              <h1 className="lp-rise text-balance text-[2rem] font-bold leading-[1.3] sm:text-5xl sm:leading-[1.25] lg:text-6xl lg:leading-[1.2]" style={{ ["--d" as string]: "120ms" }}>{hero.title}</h1>
              <p className="lp-rise mt-4 max-w-xl text-base leading-relaxed text-[#4d5753] sm:mt-5 sm:text-lg" style={{ ["--d" as string]: "240ms" }}>{c.sub}</p>
              {notice ? <p role="alert" className="mt-5 rounded-2xl bg-[#fdf1d6] px-4 py-3 text-sm font-semibold text-[#7a4f00]">{notice}</p> : null}
              {/* phones: two full-width buttons, one under the other */}
              <div className="lp-rise mt-6 flex flex-wrap items-start gap-3 sm:mt-8" style={{ ["--d" as string]: "360ms" }}>
                <div className="w-full sm:w-auto">
                  <a href="#trial" className="btn-primary min-h-12 w-full px-7 text-base sm:w-auto">{c.demo}</a>
                  <p className="mt-2 text-center text-xs text-[#66706c] sm:max-w-56 sm:text-start">{c.demoNote}</p>
                </div>
                <div className="w-full sm:w-auto">
                  <Link href="/login?mode=signup" className="btn-ghost min-h-12 w-full bg-white px-6 text-base sm:w-auto">{c.trial}</Link>
                  <p className="mt-2 text-center text-xs text-[#66706c] sm:max-w-56 sm:text-start">{c.trialNote}</p>
                </div>
              </div>
            </div>
            <div>
              <HeroStage en={en} />
              <p className="mt-2 text-center text-xs text-[#66706c]">{hero.caption}</p>
            </div>
          </div>
        </section>

        <Journey en={en} />

        <section className="mx-auto grid max-w-6xl grid-cols-3 gap-2.5 px-4 pb-4 pt-8 sm:gap-4 sm:pt-10 lg:px-8">
          {c.stats.map(([n, label], i) => (
            <Reveal key={label} delay={i * 120}>
              <div className="h-full rounded-2xl bg-white p-3.5 shadow-[0_10px_26px_rgba(20,40,35,0.06)] sm:rounded-3xl sm:p-6">
                <div className="num text-3xl font-bold text-brand sm:text-5xl">{n}</div>
                <p className="mt-1.5 text-xs leading-relaxed text-[#4d5753] sm:mt-2 sm:text-sm">{label}</p>
              </div>
            </Reveal>
          ))}
        </section>

        <Solutions en={en} />

        <Automation en={en} />

        <Replaces en={en} />

        <Pocket en={en} />

        <section className="mx-auto max-w-6xl scroll-mt-20 px-4 py-10 sm:py-16 lg:px-8" id="plans">
          <Reveal>
            <h2 className="text-balance text-3xl font-bold sm:text-4xl">{c.plansTitle}</h2>
            <p className="mt-2 max-w-2xl text-[#4d5753]">{c.plansSub}</p>
          </Reveal>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <nav className="flex gap-1 rounded-full bg-[#e4e8e5] p-1" aria-label={c.plansTitle}>
              {([["month", c.billMonth], ["year", c.billYear]] as const).map(([k, label]) => (
                <Link key={k} href={k === "year" ? "/?bill=year#plans" : "/#plans"} scroll={false} aria-current={(k === "year") === yearly ? "true" : undefined}
                  className={`tap rounded-full px-5 py-2 text-sm font-semibold ${(k === "year") === yearly ? "bg-white text-[#1c2321] shadow-sm" : "text-[#66706c] hover:text-[#1c2321]"}`}>{label}</Link>
              ))}
            </nav>
            <span className="text-sm text-[#66706c]">{c.inCur(en ? CUR[cur].en : CUR[cur].ar)}</span>
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {plans.map((p, i) => {
              const top = i === plans.length - 1;
              const pr = priceOf(p);
              return (
                <Reveal key={p.code} delay={i * 120} className="h-full">
                  <div className={`lp-card flex h-full flex-col rounded-3xl p-6 ${top ? "bg-[#0d6b5f] text-white shadow-[0_22px_50px_rgba(13,107,95,0.3)]" : "bg-white shadow-[0_10px_26px_rgba(20,40,35,0.06)]"} ${pr.was ? "ring-2 ring-[#e7b9b4]" : ""}`}>
                    <h3 className="text-lg font-bold">{en ? p.name_en ?? p.name_ar : p.name_ar}</h3>
                    {pr.was ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 rounded-xl border border-[#e7b9b4] bg-[#fdf3f2] px-2.5 py-1 text-xs font-bold text-[#8c1d18]">
                          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
                          {p.offer_label || c.offerLabel}{p.offer_ends_on ? ` · ${c.until} ${p.offer_ends_on.slice(8, 10)}/${p.offer_ends_on.slice(5, 7)}` : ""}
                        </span>
                        <span className={`text-sm ${top ? "text-white/75" : "text-[#66706c]"}`}>
                          {c.was} <s className="decoration-[#d04437] decoration-2"><Money value={fmt(pr.was, pr.c)} cur={pr.c} /></s>
                        </span>
                      </div>
                    ) : null}
                    <div className="mt-3 flex items-baseline gap-2">
                      <Money value={fmt(pr.now, pr.c)} cur={pr.c} className="text-4xl font-bold" />
                      <span className={`text-sm ${top ? "opacity-80" : "text-[#66706c]"}`}>{yearly ? c.perYear : c.perMonth}</span>
                    </div>
                    {pr.was ? <div className={`mt-1 text-sm font-bold ${top ? "text-[#cfe9e3]" : "text-[#157f3b]"}`}>{c.offerOff(`${fmt(pr.was - pr.now, pr.c)}`, yearly)}</div> : null}
                    {pr.save ? <div className={`mt-1 text-sm font-bold ${top ? "text-[#cfe9e3]" : "text-[#157f3b]"}`}>{c.saveYear(fmt(pr.save, pr.c))}</div> : null}
                    <ul className="mt-5 flex-1 space-y-2 text-sm">
                      {[c.units(p.max_units), c.props(p.max_properties), c.core, ...p.features.filter((f) => f !== "multi_property" && f !== "assistant").map((f) => FEATURE_NAMES[f]?.[en ? 1 : 0] ?? f)].map((line) => (
                        <li key={line} className="flex items-start gap-2"><Check className={`mt-0.5 size-4 shrink-0 ${top ? "" : "text-brand"}`} aria-hidden />{line}</li>
                      ))}
                    </ul>
                    <Link href="/login?mode=signup" className={`${top ? "btn bg-white text-brand hover:bg-white/90" : "btn-ghost"} mt-6 w-full`}>{c.choose}</Link>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </section>

        <section id="trial" className="scroll-mt-16 px-3 pb-12 sm:px-4 sm:pb-16 lg:px-8">
          <Reveal>
            <div className="relative mx-auto grid max-w-6xl gap-8 overflow-hidden rounded-[1.75rem] bg-white p-5 shadow-[0_22px_60px_rgba(20,40,35,0.1)] sm:rounded-[2.5rem] sm:p-10 lg:grid-cols-[1fr_1.1fr] lg:gap-12">
              <div className="pointer-events-none absolute -top-20 end-[-6rem] size-72 rounded-full bg-[#bfe3da] opacity-50 blur-3xl" aria-hidden />
              <div className="relative">
                <h2 className="text-balance text-2xl font-bold sm:text-4xl">{c.trialTitle}</h2>
                <p className="mt-3 leading-relaxed text-[#4d5753]">{c.trialSub}</p>
                <ul className="mt-6 space-y-3">
                  {c.trialPoints.map((x) => <li key={x} className="flex items-center gap-3 font-semibold"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Check className="size-4" aria-hidden /></span>{x}</li>)}
                </ul>
              </div>
              <div className="relative"><TrialForm t={c.form} /></div>
            </div>
          </Reveal>
        </section>

        <section id="faq" className="mx-auto max-w-3xl scroll-mt-20 px-4 pb-12 sm:pb-16 lg:px-8">
          <Reveal><h2 className="text-balance text-3xl font-bold">{c.faqTitle}</h2></Reveal>
          <div className="mt-6 space-y-3">
            {c.faq.map(([q, a], i) => (
              <Reveal key={q} delay={i * 80}>
                <details className="group rounded-3xl bg-white px-6 shadow-[0_10px_26px_rgba(20,40,35,0.06)]">
                  <summary className="flex min-h-14 cursor-pointer list-none items-center py-4 justify-between gap-3 font-semibold [&::-webkit-details-marker]:hidden">{q}<ArrowDown className="size-4 shrink-0 text-[#66706c] transition-transform group-open:rotate-180" aria-hidden /></summary>
                  <p className="-mt-2 pb-4 text-sm leading-relaxed text-[#4d5753]">{a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-black/5 bg-white pb-[env(safe-area-inset-bottom)]">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-sm text-[#66706c] lg:px-8">
          <span><span className="brand-word text-xl text-brand">نُزُل</span> · {c.footer}</span>
          <Link href="/login" className="tap hover:text-brand">{c.login}</Link>
        </div>
      </footer>
    </div>
  );
}
