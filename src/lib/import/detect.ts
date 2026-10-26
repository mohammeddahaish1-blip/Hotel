// Recognise what an imported sheet contains and check every row before anything is saved.
// Pure functions (no I/O) so they run the same on the server and in tests.

export const IMPORT_TYPES = ["reservations", "expenses", "units", "guests"] as const;
export type ImportType = (typeof IMPORT_TYPES)[number];
export type RowStatus = "ok" | "warn" | "skip" | "error";
export type Cell = string | number | null;

export type ImportRow = {
  n: number;                       // row number in the original sheet (1-based)
  data: Record<string, Cell>;      // normalised values ready to save
  status: RowStatus;
  notes: string[];                 // message codes (translated in the UI): imp_m_<code>
  result?: "saved" | "failed";
  error?: string;
};

export type ImportSheet = {
  name: string;
  type: ImportType | null;
  headerRow: number;               // index in raw
  header: string[];
  mapping: Record<string, number>; // field -> column index
  raw: string[][];
  rows: ImportRow[];
};

export type Lookups = {
  today: string;
  unitTypes: { id: string; name_ar: string; name_en: string | null }[];
  floors: { id: string; name: string }[];
  units: { id: string; number: string }[];
  guests: { id: string; full_name: string; phone: string | null; doc_number: string | null }[];
};

/** Arabic/English spelling-insensitive form used for matching headers and labels. */
export function norm(v: unknown): string {
  return String(v ?? "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[*:：.()\[\]#_\-/\\]+/g, " ")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const NAME = ["الاسم", "اسم النزيل", "اسم الضيف", "الاسم الكامل", "النزيل", "الضيف", "اسم العميل", "العميل", "name", "guest", "guest name", "full name", "customer"];
const PHONE = ["الهاتف", "الجوال", "رقم الهاتف", "رقم الجوال", "الموبايل", "phone", "mobile", "phone number", "tel"];
const ROOM = ["رقم الوحده", "رقم الغرفه", "الوحده", "الغرفه", "رقم الشقه", "الشقه", "unit", "room", "room no", "unit no", "room number", "unit number", "apartment"];

const FIELDS: Record<ImportType, { fields: Record<string, string[]>; required: string[][] }> = {
  reservations: {
    fields: {
      room: ROOM,
      guest: NAME,
      phone: PHONE,
      from: ["الوصول", "تاريخ الوصول", "من", "من تاريخ", "الدخول", "تاريخ الدخول", "check in", "checkin", "arrival", "from"],
      to: ["المغادره", "تاريخ المغادره", "الي", "الى تاريخ", "الخروج", "تاريخ الخروج", "check out", "checkout", "departure", "to"],
      source: ["المصدر", "القناه", "مصدر الحجز", "source", "channel"],
      adults: ["البالغين", "البالغون", "عدد الاشخاص", "عدد النزلاء", "الاشخاص", "adults", "guests", "pax"],
    },
    required: [["room"], ["from"], ["to"]],
  },
  expenses: {
    fields: {
      date: ["التاريخ", "تاريخ المصروف", "date"],
      category: ["البند", "الفئه", "التصنيف", "النوع", "category", "type"],
      description: ["الوصف", "البيان", "التفاصيل", "ملاحظات", "description", "details", "item", "memo"],
      amount: ["المبلغ", "القيمه", "المبلغ ر ع", "الاجمالي", "amount", "total", "value", "cost"],
      method: ["طريقه الدفع", "الدفع", "وسيله الدفع", "method", "payment method", "payment"],
    },
    required: [["amount"], ["description", "category"]],
  },
  units: {
    fields: {
      number: ROOM,
      type: ["النوع", "نوع الوحده", "نوع الغرفه", "الفئه", "type", "room type", "unit type", "category"],
      floor: ["الطابق", "الدور", "floor", "level"],
      rate: ["السعر", "سعر الليله", "السعر اليومي", "rate", "price", "nightly rate"],
    },
    required: [["number"], ["type", "floor", "rate"]],
  },
  guests: {
    fields: {
      name: NAME,
      phone: PHONE,
      nationality: ["الجنسيه", "nationality", "country"],
      doc_type: ["نوع الوثيقه", "نوع الهويه", "نوع الاثبات", "document type", "id type"],
      doc_number: ["رقم الوثيقه", "رقم الهويه", "رقم الجواز", "الرقم المدني", "رقم البطاقه", "id", "passport", "id number", "passport number", "document number", "civil id"],
      doc_expiry: ["تاريخ الانتهاء", "انتهاء الوثيقه", "انتهاء الهويه", "expiry", "expiry date"],
      email: ["البريد", "البريد الالكتروني", "الايميل", "email", "e mail"],
    },
    required: [["name"]],
  },
};

const SYN: Record<ImportType, Record<string, string[]>> = Object.fromEntries(
  IMPORT_TYPES.map((t) => [t, Object.fromEntries(Object.entries(FIELDS[t].fields).map(([f, list]) => [f, list.map(norm)]))]),
) as Record<ImportType, Record<string, string[]>>;

/** Which column holds which field, for one candidate header row. Exact matches win over partial ones. */
function mapHeader(cells: string[], type: ImportType): Record<string, number> {
  const mapping: Record<string, number> = {};
  const used = new Set<number>();
  const n = cells.map(norm);
  for (const pass of ["exact", "partial"] as const) {
    for (const [field, syns] of Object.entries(SYN[type])) {
      if (field in mapping) continue;
      const i = n.findIndex((c, idx) => !used.has(idx) && c !== "" &&
        (pass === "exact" ? syns.includes(c) : c.length <= 40 && syns.some((s) => s.length >= 3 && (c.startsWith(s + " ") || c.endsWith(" " + s) || c.includes(" " + s + " ")))));
      if (i >= 0) {
        mapping[field] = i;
        used.add(i);
      }
    }
  }
  return mapping;
}

const satisfies = (type: ImportType, m: Record<string, number>) => FIELDS[type].required.every((anyOf) => anyOf.some((f) => f in m));

/** How header-like a row looks (any type) — used to find the header line in PDFs. */
export function headerScore(cells: string[]) {
  return Math.max(...IMPORT_TYPES.map((t) => Object.keys(mapHeader(cells, t)).length));
}

/** Find the header row and the most plausible data type for a sheet. */
export function detect(raw: string[][], force?: ImportType | null) {
  let best: { type: ImportType; headerRow: number; mapping: Record<string, number>; score: number } | null = null;
  const types = force ? [force] : IMPORT_TYPES;
  for (let r = 0; r < Math.min(raw.length, 15); r++) {
    for (const type of types) {
      const mapping = mapHeader(raw[r], type);
      const ok = satisfies(type, mapping);
      // required fields first, then more matched columns; earlier types in IMPORT_TYPES win ties
      const score = (ok ? 100 : 0) + Object.keys(mapping).length;
      if (!best || score > best.score) best = { type, headerRow: r, mapping, score };
    }
  }
  if (!best || (best.score < 100 && !force)) return { type: null, headerRow: 0, mapping: {} as Record<string, number> };
  return { type: best.type, headerRow: best.headerRow, mapping: best.mapping };
}

// ------------------------------------------------------------------ values

export function parseDate(v: Cell): string | null {
  if (v === null || v === "") return null;
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v))) {
    const serial = Number(v); // Excel serial date
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10);
    return null;
  }
  const s = norm(v).replace(/\s+/g, " ");
  let m = /^(\d{4})[ ./-](\d{1,2})[ ./-](\d{1,2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  else if ((m = /^(\d{1,2})[ ./-](\d{1,2})[ ./-](\d{2,4})$/.exec(s))) {
    // Oman/Gulf convention: day first
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  } else return null;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d || y < 1900 || y > 2100) return null;
  return dt.toISOString().slice(0, 10);
}

/** OMR text/number → baisa (integer). */
export function parseAmount(v: Cell): number | null {
  if (v === null || v === "") return null;
  const s = norm(v).replace(/ر ?ع|omr|ro|ريال|عماني/g, "").replace(/[,\s]/g, "").replace(/٫/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Math.round(Number(s) * 1000);
  return Number.isFinite(n) ? n : null;
}

const cleanPhone = (v: Cell) => {
  const s = norm(v).replace(/[^\d+]/g, "");
  return s.length >= 6 ? s : null;
};
const digits = (s: string | null) => (s ?? "").replace(/\D/g, "").slice(-8);

function pick(map: [string, string[]][], v: Cell): string | null {
  const n = norm(v);
  if (!n) return null;
  for (const [key, words] of map) if (words.some((w) => n === norm(w) || n.includes(norm(w)))) return key;
  return null;
}

const CATEGORIES: [string, string[]][] = [
  ["utilities", ["utilities", "كهرباء", "ماء", "مياه", "فواتير"]],
  ["salaries", ["salaries", "salary", "رواتب", "راتب", "اجور"]],
  ["maintenance", ["maintenance", "صيانه", "اصلاح"]],
  ["supplies", ["supplies", "مستلزمات", "مشتريات", "لوازم"]],
  ["laundry", ["laundry", "مغسله", "غسيل"]],
  ["marketing", ["marketing", "تسويق", "اعلان", "اعلانات"]],
  ["rent", ["rent", "ايجار"]],
  ["commission", ["commission", "عموله", "عمولات"]],
  ["government", ["government", "حكوميه", "رسوم", "بلديه", "ضريبه"]],
  ["other", ["other", "اخري", "اخرى", "متفرقات"]],
];
const METHODS: [string, string[]][] = [
  ["cash", ["cash", "نقد", "نقدا", "كاش"]],
  ["card", ["card", "بطاقه", "شبكه", "فيزا", "visa", "mada"]],
  ["transfer", ["transfer", "bank", "تحويل", "بنك", "حواله", "شيك", "cheque", "check"]],
];
const DOC_TYPES: [string, string[]][] = [
  ["oman_id", ["oman id", "هويه عمانيه", "بطاقه مدنيه", "مدني", "بطاقه شخصيه"]],
  ["gcc_id", ["gcc", "خليجي", "هويه خليجيه"]],
  ["passport", ["passport", "جواز", "جواز سفر"]],
  ["resident_card", ["resident", "مقيم", "بطاقه مقيم", "اقامه"]],
];
const SOURCES: [string, string[]][] = [
  ["booking", ["booking"]], ["agoda", ["agoda", "اقودا", "اجودا"]], ["expedia", ["expedia"]], ["airbnb", ["airbnb", "اير بي ان بي"]],
  ["whatsapp", ["whatsapp", "واتساب", "واتس"]], ["phone", ["phone", "هاتف", "اتصال"]], ["walk_in", ["walk in", "walk-in", "حضور", "مباشر حضور"]],
  ["corporate", ["corporate", "شركه", "شركات"]], ["direct", ["direct", "مباشر"]], ["other", ["other", "اخري", "اخرى"]],
];

// ------------------------------------------------------------------ validation

const cellAt = (row: string[], m: Record<string, number>, f: string): string | null => {
  const i = m[f];
  if (i === undefined) return null;
  const v = (row[i] ?? "").trim();
  return v === "" ? null : v;
};

/** Validate every data row of a sheet for the given type. Nothing is written here. */
export function validate(raw: string[][], type: ImportType, headerRow: number, mapping: Record<string, number>, lk: Lookups): ImportRow[] {
  const headerNorm = raw[headerRow]?.map(norm).join("|");
  const units = new Map(lk.units.map((u) => [norm(u.number), u.id]));
  const types = lk.unitTypes;
  const floors = new Map(lk.floors.map((f) => [norm(f.name), f.id]));
  const byPhone = new Map(lk.guests.filter((g) => g.phone).map((g) => [digits(g.phone), g.id]));
  const byDoc = new Map(lk.guests.filter((g) => g.doc_number).map((g) => [norm(g.doc_number), g.id]));
  const byName = new Map(lk.guests.map((g) => [norm(g.full_name), g.id]));
  const seen = new Set<string>();
  const out: ImportRow[] = [];

  for (let r = headerRow + 1; r < raw.length && out.length < 2000; r++) {
    const row = raw[r];
    if (!row || row.every((c) => !String(c ?? "").trim())) continue;
    if (row.map(norm).join("|") === headerNorm) continue; // header repeated on a new PDF page
    const v = (f: string) => cellAt(row, mapping, f);
    const notes: string[] = [];
    let status: RowStatus = "ok";
    const warn = (c: string) => { notes.push(c); if (status === "ok") status = "warn"; };
    const fail = (c: string) => { notes.push(c); status = "error"; };
    const skip = (c: string) => { notes.push(c); if (status !== "error") status = "skip"; };
    const data: Record<string, Cell> = {};

    if (type === "units") {
      const number = v("number");
      if (!number) fail("missing_number");
      else {
        data.number = number;
        const key = norm(number);
        if (seen.has(key)) fail("dup_in_file");
        seen.add(key);
        if (units.has(key)) skip("unit_exists");
      }
      const tname = v("type");
      const match = tname ? types.find((t) => norm(t.name_ar) === norm(tname) || norm(t.name_en) === norm(tname)) : undefined;
      if (match) data.unit_type_id = match.id;
      else if (tname) { data.new_type = tname; warn("new_type"); }
      else if (types.length === 1) { data.unit_type_id = types[0].id; warn("default_type"); }
      else fail("missing_type");
      const rate = v("rate");
      if (rate) {
        const b = parseAmount(rate);
        if (b === null || b < 0) warn("bad_rate"); else data.rate = b;
      }
      const floor = v("floor");
      if (floor) {
        const f = floors.get(norm(floor));
        if (f) data.floor_id = f; else { data.new_floor = floor; warn("new_floor"); }
      }
    }

    if (type === "guests") {
      const name = v("name");
      if (!name) fail("missing_name"); else data.full_name = name.slice(0, 200);
      const phone = v("phone") ? cleanPhone(v("phone")) : null;
      data.phone = phone;
      const docNo = v("doc_number");
      data.doc_number = docNo ? docNo.slice(0, 50) : null;
      const key = (phone && digits(phone)) || (docNo && norm(docNo)) || "";
      if (key && seen.has(key)) skip("dup_in_file");
      if (key) seen.add(key);
      if ((phone && byPhone.has(digits(phone))) || (docNo && byDoc.has(norm(docNo)))) skip("guest_exists");
      const dt = v("doc_type");
      if (dt) {
        const k = pick(DOC_TYPES, dt);
        data.doc_type = k ?? "other";
        if (!k) warn("doc_type_other");
      } else if (docNo) data.doc_type = "other";
      const exp = v("doc_expiry");
      if (exp) {
        const d = parseDate(exp);
        if (d) data.doc_expiry = d; else warn("bad_date");
      }
      data.nationality = v("nationality")?.slice(0, 60) ?? null;
      const email = v("email");
      data.email = email && /^\S+@\S+\.\S+$/.test(email) ? email : null;
      if (email && !data.email) warn("bad_email");
    }

    if (type === "expenses") {
      const amount = parseAmount(v("amount"));
      if (amount === null || amount <= 0) fail("bad_amount"); else data.amount = amount;
      const rawDate = v("date");
      const d = parseDate(rawDate);
      if (d) data.expense_date = d;
      else if (rawDate) fail("bad_date");
      else { data.expense_date = lk.today; warn("no_date"); }
      const cat = v("category");
      const k = cat ? pick(CATEGORIES, cat) : null;
      data.category = k ?? "other";
      if (cat && !k) warn("other_category");
      data.description = (v("description") ?? cat ?? "").slice(0, 300);
      if (!data.description) fail("missing_description");
      const m = v("method");
      const mk = m ? pick(METHODS, m) : null;
      data.method = mk ?? "cash";
      if (m && !mk) warn("other_method");
    }

    if (type === "reservations") {
      const room = v("room");
      const unit = room ? units.get(norm(room)) : undefined;
      if (!room) fail("missing_room");
      else if (!unit) fail("unknown_room");
      else { data.unit_id = unit; data.room = room; }
      const from = parseDate(v("from"));
      const to = parseDate(v("to"));
      if (!from || !to || to <= from) fail("bad_dates");
      else {
        data.from = from;
        data.to = to;
        if (to <= lk.today) fail("past_stay");
        else if (from < lk.today) warn("in_progress_stay");
      }
      const name = v("guest");
      const phone = v("phone") ? cleanPhone(v("phone")) : null;
      if (!name && !phone) fail("missing_guest");
      data.guest_name = name ?? phone;
      data.phone = phone;
      const g = (phone && byPhone.get(digits(phone))) || (name && byName.get(norm(name))) || null;
      if (g) data.guest_id = g; else if (name || phone) warn("new_guest");
      const src = v("source");
      const sk = src ? pick(SOURCES, src) : null;
      data.source = sk ?? (src ? "other" : "direct");
      if (src && !sk) warn("other_source");
      const adults = Number(norm(v("adults") ?? "1"));
      data.adults = Number.isInteger(adults) && adults > 0 && adults < 30 ? adults : 1;
    }

    out.push({ n: r + 1, data, status, notes });
  }
  return out;
}

export function counts(rows: ImportRow[]) {
  return {
    ready: rows.filter((r) => r.status === "ok").length,
    warnings: rows.filter((r) => r.status === "warn" || r.status === "skip").length,
    errors: rows.filter((r) => r.status === "error").length,
  };
}
