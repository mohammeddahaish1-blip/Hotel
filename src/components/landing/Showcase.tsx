import type { ReactNode } from "react";
import { CurrencySign } from "@/components/CurrencySign";
import { Reveal } from "./Reveal";

/** Second half of the public page: the product shown on a phone, the guest's journey and small live samples.
 *  Server-rendered; all motion is CSS (globals.css, "lp2-"). Figures in the samples are made up. */

const i = (n: number) => ({ ["--i" as string]: n });

const T = {
  ar: {
    board: "لوحة حالة الوحدات في نُزُل على الجوال", dash: "لوحة المالك في نُزُل على الجوال",
    chips: [["الوحدة 204 جاهزة", "أنهى التنظيف قبل دقيقتين"], ["دفعة مستلمة 120 ¤", "سند قبض رقم 1042"], ["وصول اليوم: 3 نزلاء", ""]],
    jKicker: "رحلة النزيل من البداية إلى النهاية", jTitle: "كم دفتراً وبرنامجاً تحتاج لتشغيل فندق واحد؟",
    jSub: "لا ورقة تضيع بين الاستقبال والمحاسب، ولا غرفة تُنسى بعد المغادرة.",
    steps: [["الحجز", "من التقويم أو من Booking وAirbnb، بلا حجز مزدوج."], ["الوصول", "قراءة البطاقة أو الجواز وتسجيل النزيل في دقيقة."], ["الإقامة", "تنظيف، صيانة، وطلبات المحلات على حساب الغرفة."], ["الدفع", "فاتورة بالرسوم والضريبة، وسند قبض مرقّم."], ["المغادرة", "تسوية الحساب، والغرفة تذهب للتنظيف تلقائياً."]],
    sKicker: "ماذا يفعل نُزُل", sTitle: "كل ما يحتاجه يومك في الفندق", sSub: "كل قسم يعمل وحده، وكلها تلتقي في حساب واحد وأرقام واحدة.",
    units: ["حالة الوحدات", "ترى كل غرفة وشقة لحظة بلحظة، وتحجز منها مباشرة."],
    st: { a: "متاحة", d: "تحتاج تنظيف", m: "صيانة", o: "مشغولة" },
    desk: ["يوم الاستقبال", "من يغادر ومن يصل، بالترتيب."], ev: ["مغادرة 201", "تنظيف 201", "الغرفة جاهزة", "وصول سالم الحارثي"],
    bill: ["الفواتير والرسوم", "رسوم السياحة والبلدية والضريبة تُحسب وحدها."], lines: ["إقامة ليلتين", "رسم السياحة 4%", "رسم البلدية 5%", "ضريبة القيمة المضافة 5%", "الإجمالي (ر.ع.)"],
    wa: ["واتساب والتذكير", "رسائل جاهزة للتأكيد وتذكير المتأخرين."], msgs: ["مرحباً سالم، حجزك في الوحدة 204 مؤكد ليوم الخميس.", "شكراً، متى وقت الدخول؟", "من الساعة 2 ظهراً. هذا رابط الدفع المسبق."],
    shops: ["المحلات", "دخل المغسلة والكافتيريا يومياً، وإيجار المحلات المؤجرة."],
    roles: ["لكل موظف ما يخصه", "المالك يرى كل شيء، والبقية يرون عملهم فقط، وكل تعديل مسجّل باسم صاحبه."], roleList: ["المالك", "المدير", "الاستقبال", "المحاسب", "التنظيف", "الصيانة"],
    rent: ["الإيجار الشهري والعقود", "عقود الشقق وجدول الدفعات والشيكات المؤجلة، مع تنبيه قبل انتهاء العقد وكشوف لملاك الوحدات."], rentList: ["عقد 12 شهراً", "شيك مستحق 1 ديسمبر", "ينتهي بعد 30 يوماً"],
    aKicker: "بلا متابعة يدوية", aTitle: "أنت تضع القاعدة مرة واحدة، ونُزُل ينفّذ", aSub: "عندما يغادر نزيل لا تحتاج أن تتصل بأحد: كل خطوة تفتح التي بعدها.",
    manual: ["بالهاتف والورقة", ["نزيل يغادر", "تتصل بالتنظيف", "تسأل: هل انتهوا؟", "تغيّر حالة الغرفة"], "أنت الحلقة بين كل خطوة والتي بعدها."],
    auto: ["في نُزُل", ["نزيل يغادر", "مهمة تنظيف تُنشأ", "العامل يضغط «جاهزة»", "الغرفة متاحة للحجز"], "لا أحد ينتظر اتصالاً، وأنت ترى كل شيء من اللوحة."],
    rKicker: "قبل وبعد", rTitle: "استبدل الدفاتر والجداول بنظام واحد", rHead: ["العمل", "كما يجري اليوم", "في نُزُل"], yes: "موجود",
    rep: [["سجل النزلاء", "دفتر ورقي وصور هويات في الجوال"], ["الحسابات والديون", "جدول Excel يحدّثه شخص واحد"], ["التنظيف والصيانة", "مجموعة واتساب ومكالمات"], ["الصندوق والورديات", "دفتر الصندوق وعدّ يدوي"], ["حجوزات Booking وAirbnb", "نقل يدوي بين التقاويم"]],
    pKicker: "على الجوال", pTitle: "مكتبك معك أينما كنت", pSub: "افتح نُزُل من متصفح الجوال وأضفه إلى الشاشة الرئيسية، فيعمل مثل التطبيق. بلا تنزيل ولا تحديثات.", devs: ["الجوال", "الآيباد", "الكمبيوتر"],
  },
  en: {
    board: "The Nuzul units board on a phone", dash: "The Nuzul owner dashboard on a phone",
    chips: [["Unit 204 is ready", "Cleaning finished two minutes ago"], ["Payment received 120 ¤", "Receipt no. 1042"], ["Arriving today: 3 guests", ""]],
    jKicker: "The guest's journey, start to finish", jTitle: "How many notebooks and apps does one hotel take?",
    jSub: "No paper goes missing between the front desk and the accountant, and no room is forgotten after check-out.",
    steps: [["Booking", "From the calendar or from Booking and Airbnb, with no double bookings."], ["Arrival", "Read the ID or passport and register the guest in a minute."], ["Stay", "Housekeeping, maintenance, and shop orders on the room account."], ["Payment", "An invoice with fees and tax, and a numbered receipt."], ["Departure", "The account is settled and the room goes to housekeeping by itself."]],
    sKicker: "What Nuzul does", sTitle: "Everything your hotel's day needs", sSub: "Each part works on its own, and they all meet in one account and one set of numbers.",
    units: ["Units board", "See every room and apartment as it changes, and book straight from it."],
    st: { a: "Available", d: "Needs cleaning", m: "Maintenance", o: "Occupied" },
    desk: ["The front desk's day", "Who leaves and who arrives, in order."], ev: ["Check-out 201", "Cleaning 201", "Room ready", "Salim Al Harthy arrives"],
    bill: ["Invoices and fees", "Tourism levy, municipality fee and VAT are worked out for you."], lines: ["Two nights", "Tourism levy 4%", "Municipality fee 5%", "VAT 5%", "Total (OMR)"],
    wa: ["WhatsApp and reminders", "Ready messages for confirmations and late payers."], msgs: ["Hello Salim, your booking for unit 204 is confirmed for Thursday.", "Thanks, what time is check-in?", "From 2 pm. Here is the prepayment link."],
    shops: ["Shops", "Daily takings of the laundry and café, and rent from let shops."],
    roles: ["Each employee sees their part", "The owner sees everything, the rest see only their work, and every change is logged by name."], roleList: ["Owner", "Manager", "Front desk", "Accountant", "Housekeeping", "Maintenance"],
    rent: ["Monthly rentals and contracts", "Apartment contracts, payment schedules and post-dated cheques, with a reminder before a contract ends and statements for unit owners."], rentList: ["12-month contract", "Cheque due 1 December", "Ends in 30 days"],
    aKicker: "No chasing", aTitle: "You set the rule once, Nuzul carries it out", aSub: "When a guest leaves you do not need to call anyone: each step opens the next.",
    manual: ["By phone and paper", ["A guest leaves", "You call housekeeping", "You ask: are they done?", "You change the room status"], "You are the link between every step and the next."],
    auto: ["In Nuzul", ["A guest leaves", "A cleaning task is created", "The cleaner taps “Ready”", "The room is open for booking"], "Nobody waits for a call, and you see it all on the board."],
    rKicker: "Before and after", rTitle: "Swap the notebooks and spreadsheets for one system", rHead: ["The job", "How it runs today", "In Nuzul"], yes: "Included",
    rep: [["Guest register", "A paper book and ID photos on a phone"], ["Accounts and debts", "An Excel sheet one person updates"], ["Housekeeping and maintenance", "A WhatsApp group and phone calls"], ["Cash drawer and shifts", "A cash book and counting by hand"], ["Booking and Airbnb bookings", "Copying between calendars by hand"]],
    pKicker: "On the phone", pTitle: "Your office goes where you go", pSub: "Open Nuzul in your phone's browser and add it to the home screen, and it works like an app. Nothing to download or update.", devs: ["Phone", "iPad", "Computer"],
  },
};

/** A phone showing a real screen of the system. */
export function Phone({ src, alt, roll = false, tilt = -5, className = "", first = false }: { src: string; alt: string; roll?: boolean; tilt?: number; className?: string; first?: boolean }) {
  return (
    <div className={`lp2-phone ${className}`} style={{ ["--tilt" as string]: `${tilt}deg` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div className="lp2-screen"><div className={roll ? "lp2-roll" : ""}><img src={src} alt={alt} width={390} height={800} {...(first ? { fetchPriority: "high" as const } : { loading: "lazy" as const })} /></div></div>
    </div>
  );
}

/** Gold guide lines with a dot travelling along them. */
export function GoldLines({ id }: { id: string }) {
  return (
    <svg className="lp2-lines" viewBox="0 0 520 720" preserveAspectRatio="none" aria-hidden>
      <path id={`${id}1`} d="M520 70 H420 a40 40 0 0 0 -40 40 V250 a40 40 0 0 1 -40 40 H0" />
      <path d="M0 520 H70 a40 40 0 0 1 40 40 V720" />
      <path id={`${id}3`} d="M520 430 H470 a36 36 0 0 0 -36 36 V640 a36 36 0 0 1 -36 36 H300" />
      <circle r="6"><animateMotion dur="7s" repeatCount="indefinite"><mpath href={`#${id}1`} /></animateMotion></circle>
      <circle r="5"><animateMotion dur="9s" repeatCount="indefinite"><mpath href={`#${id}3`} /></animateMotion></circle>
    </svg>
  );
}

/** "120 ¤" → the figure with the Omani rial sign in place of the mark. */
function withSign(text: string) {
  const [before, after] = text.split("¤");
  return after === undefined ? text : <>{before}<CurrencySign cur="OMR" />{after}</>;
}

export function HeroStage({ en }: { en: boolean }) {
  const t = en ? T.en : T.ar;
  const icons = ["✓", "+", "↘"];
  return (
    <div className="lp2-stage">
      <div className="lp2-glow" aria-hidden />
      <GoldLines id="hl" />
      <Phone src="/landing/board.jpg" alt={t.board} first />
      {t.chips.map(([a, b], k) => (
        <div key={a} className={`lp2-chip lp2-c${k + 1}`} aria-hidden>
          <i>{icons[k]}</i><span>{withSign(a)}{b ? <small>{b}</small> : null}</span>
        </div>
      ))}
    </div>
  );
}

function Head({ kicker, title, sub, light = false }: { kicker: string; title: string; sub?: string; light?: boolean }) {
  return (
    <Reveal>
      <div className="lp2-kicker" style={light ? { color: "#f0cf7a" } : undefined}>{kicker}</div>
      <h2 className="text-balance text-[1.65rem] font-bold leading-tight sm:text-4xl lg:text-[2.75rem]">{title}</h2>
      {sub ? <p className={`mt-3 max-w-2xl text-base sm:text-lg ${light ? "text-[#b9d6d0]" : "text-[#4d5753]"}`}>{sub}</p> : null}
    </Reveal>
  );
}

function Card({ title, sub, span, delay = 0, children }: { title: string; sub: string; span: string; delay?: number; children: ReactNode }) {
  return (
    <Reveal delay={delay} className={span}>
      <div className="lp-card h-full overflow-hidden rounded-[1.6rem] border border-[#e4e0d6] bg-white p-5 sm:p-6">
        <h3 className="text-xl font-bold">{title}</h3>
        <p className="mb-4 mt-1 text-[15px] text-[#66706c]">{sub}</p>
        {children}
      </div>
    </Reveal>
  );
}

export function Journey({ en }: { en: boolean }) {
  const t = en ? T.en : T.ar;
  return (
    <section id="journey" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-10 sm:pt-16 lg:px-8 lg:pt-20">
      <Head kicker={t.jKicker} title={t.jTitle} sub={t.jSub} />
      <Reveal className="mt-8 sm:mt-12">
        <ol className="lp2-jr">
          {t.steps.map(([a, b], k) => (
            <li key={a} className="lp2-st" style={i(k)}>
              <b className="num">{k + 1}</b>
              <h3 className="text-[17px] font-bold">{a}</h3>
              <p className="text-sm text-[#66706c]">{b}</p>
            </li>
          ))}
        </ol>
      </Reveal>
    </section>
  );
}

export function Solutions({ en }: { en: boolean }) {
  const t = en ? T.en : T.ar;
  const tiles: [string, "a" | "d" | "m" | "o" | "c"][] = [["101", "a"], ["102", "d"], ["103", "c"], ["104", "a"], ["201", "o"], ["202", "a"], ["203", "m"], ["204", "o"]];
  const times = ["12:00", "12:10", "13:20", "14:00"];
  const dots = ["#3b4a78", "#d9a531", "#157f3b", "#0d6b5f"];
  const amounts = ["50.000", "2.000", "2.500", "2.500", "57.000"];
  const bars = [45, 62, 38, 78, 55, 96, 70];
  return (
    <section id="features" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-10 sm:py-16 lg:px-8 lg:py-20">
      <Head kicker={t.sKicker} title={t.sTitle} sub={t.sSub} />
      <div className="mt-10 grid gap-4 lg:grid-cols-6">
        <Card title={t.units[0]} sub={t.units[1]} span="lg:col-span-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-hidden>
            {tiles.map(([n, s]) => s === "c"
              ? <div key={n} className="lp2-tile lp2-cycle num">{n}<small><span>{t.st.o}</span><span>{t.st.d}</span><span>{t.st.a}</span></small></div>
              : <div key={n} className={`lp2-tile num ${s === "a" ? "" : s}`}>{n}<small>{t.st[s]}</small></div>)}
          </div>
        </Card>
        <Card title={t.desk[0]} sub={t.desk[1]} span="lg:col-span-2" delay={110}>
          <div className="grid gap-2" aria-hidden>
            {t.ev.map((e, k) => (
              <div key={e} className="lp2-ev flex items-center gap-2.5 rounded-xl bg-[#f6f4ef] px-3 py-2.5 text-sm font-semibold" style={i(k)}>
                <span className="size-2.5 rounded-full" style={{ background: dots[k] }} />{e}<time className="num ms-auto font-medium text-[#66706c]" dir="ltr">{times[k]}</time>
              </div>
            ))}
          </div>
        </Card>
        <Card title={t.bill[0]} sub={t.bill[1]} span="lg:col-span-2">
          <div className="rounded-2xl bg-[#f6f4ef] p-3.5 text-sm" aria-hidden>
            {t.lines.map((l, k) => (
              <div key={l} className={`flex justify-between py-1 ${k === 4 ? "mt-1.5 border-t border-dashed border-[#d9d4c7] pt-2 text-base font-bold" : ""}`}><span>{l}</span><span className="num">{amounts[k]}</span></div>
            ))}
          </div>
        </Card>
        <Card title={t.wa[0]} sub={t.wa[1]} span="lg:col-span-2" delay={110}>
          <div className="grid gap-2" style={{ ["--gap" as string]: "0.9s" }} aria-hidden>
            {t.msgs.map((m, k) => (
              <div key={m} className={`lp2-bub max-w-[86%] px-3 py-2 text-sm ${k === 1 ? "justify-self-end rounded-[16px_16px_16px_4px] bg-[#f6f4ef]" : "rounded-[16px_16px_4px_16px] bg-[#dcf5d3]"}`} style={i(k)}>{m}</div>
            ))}
          </div>
        </Card>
        <Card title={t.shops[0]} sub={t.shops[1]} span="lg:col-span-2" delay={220}>
          <div className="lp2-bars flex h-24 items-end gap-2" aria-hidden>
            {bars.map((h, k) => <i key={k} style={{ height: `${h}%`, ...i(k), ...(k === 5 ? { background: "#0d6b5f" } : {}) }} />)}
          </div>
        </Card>
        <Card title={t.roles[0]} sub={t.roles[1]} span="lg:col-span-3">
          <div className="flex flex-wrap gap-2">
            {t.roleList.map((r, k) => <span key={r} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${k === 0 ? "border-brand bg-brand text-white" : "border-[#e4e0d6]"}`}>{r}</span>)}
          </div>
        </Card>
        <Card title={t.rent[0]} sub={t.rent[1]} span="lg:col-span-3" delay={110}>
          <div className="flex flex-wrap gap-2">
            {t.rentList.map((r, k) => <span key={r} className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold ${k === 2 ? "border-[#d9a531] bg-[#fbf1d6] text-[#6b4a00]" : "border-[#e4e0d6]"}`}>{r}</span>)}
          </div>
        </Card>
      </div>
    </section>
  );
}

export function Automation({ en }: { en: boolean }) {
  const t = en ? T.en : T.ar;
  const lane = ([title, steps, note]: (typeof t)["manual"], auto: boolean) => (
    <div className={`h-full rounded-[1.6rem] border p-6 ${auto ? "lp2-auto border-[#2f8f82] bg-[#0d6b5f]" : "border-white/15 bg-white/5"}`}>
      <h3 className="mb-4 text-lg font-bold">{title as string}</h3>
      <div className="lp2-flow flex flex-wrap items-center gap-2">
        {(steps as string[]).map((s, k) => <span key={s} style={i(k)}>{s}</span>)}
      </div>
      <p className={`mt-4 text-[15px] ${auto ? "text-[#d6efe9]" : "text-[#b9d6d0]"}`}>{note as string}</p>
    </div>
  );
  return (
    <section id="day" className="scroll-mt-16 px-3 lg:px-4">
      <div className="rounded-[1.75rem] bg-[#083f39] text-white sm:rounded-[2.5rem]">
        <div className="mx-auto max-w-6xl px-4 py-10 sm:py-16 lg:px-8 lg:py-20">
          <Head kicker={t.aKicker} title={t.aTitle} sub={t.aSub} light />
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <Reveal className="h-full">{lane(t.manual, false)}</Reveal>
            <Reveal delay={140} className="h-full">{lane(t.auto, true)}</Reveal>
          </div>
        </div>
      </div>
    </section>
  );
}

export function Replaces({ en }: { en: boolean }) {
  const t = en ? T.en : T.ar;
  return (
    <section className="mx-auto max-w-6xl px-4 py-10 sm:py-16 lg:px-8 lg:py-20">
      <Head kicker={t.rKicker} title={t.rTitle} />
      <Reveal className="mt-9">
        <div className="overflow-hidden rounded-[1.6rem] border border-[#e4e0d6] bg-white">
          <div className="hidden grid-cols-[1fr_1.3fr_8rem] gap-3 bg-[#f6f4ef] px-6 py-3 text-[13px] font-semibold text-[#66706c] sm:grid">
            <span>{t.rHead[0]}</span><span>{t.rHead[1]}</span><span className="justify-self-end">{t.rHead[2]}</span>
          </div>
          {t.rep.map(([job, old], k) => (
            <div key={job} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-0.5 border-t border-[#e4e0d6] px-6 py-4 sm:grid-cols-[1fr_1.3fr_8rem]">
              <b>{job}</b>
              <s className="col-start-1 text-[#66706c] decoration-[#b42318]/70 decoration-1 sm:col-start-2 sm:decoration-[#b42318] sm:decoration-2"><span className="sr-only">{t.rHead[1]}: </span>{old}</s>
              <span className="lp2-yes col-start-2 row-span-2 row-start-1 justify-self-end sm:col-start-3 sm:row-span-1" style={i(k)}>{t.yes}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

export function Pocket({ en }: { en: boolean }) {
  const t = en ? T.en : T.ar;
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-10 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
      <Reveal className="grid place-items-center"><Phone src="/landing/dash.jpg" alt={t.dash} tilt={4} /></Reveal>
      <div>
        <Head kicker={t.pKicker} title={t.pTitle} sub={t.pSub} />
        <Reveal delay={120}>
          <div className="mt-6 flex flex-wrap gap-2.5">
            {t.devs.map((d) => <span key={d} className="rounded-2xl border border-[#e4e0d6] bg-white px-4 py-2.5 text-[15px] font-semibold">{d}</span>)}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
