/**
 * Countries for the phone field: ISO 3166 alpha-2, alpha-3 (as stored in guests.nationality) and the
 * international dialling code. Names come from Intl.DisplayNames in the user's language.
 */
const RAW =
  "AF AFG 93|AL ALB 355|DZ DZA 213|AD AND 376|AO AGO 244|AG ATG 1|AR ARG 54|AM ARM 374|AU AUS 61|AT AUT 43|AZ AZE 994|" +
  "BS BHS 1|BH BHR 973|BD BGD 880|BB BRB 1|BY BLR 375|BE BEL 32|BZ BLZ 501|BJ BEN 229|BT BTN 975|BO BOL 591|BA BIH 387|" +
  "BW BWA 267|BR BRA 55|BN BRN 673|BG BGR 359|BF BFA 226|BI BDI 257|KH KHM 855|CM CMR 237|CA CAN 1|CV CPV 238|CF CAF 236|" +
  "TD TCD 235|CL CHL 56|CN CHN 86|CO COL 57|KM COM 269|CG COG 242|CD COD 243|CR CRI 506|CI CIV 225|HR HRV 385|CU CUB 53|" +
  "CY CYP 357|CZ CZE 420|DK DNK 45|DJ DJI 253|DM DMA 1|DO DOM 1|EC ECU 593|EG EGY 20|SV SLV 503|GQ GNQ 240|ER ERI 291|" +
  "EE EST 372|SZ SWZ 268|ET ETH 251|FJ FJI 679|FI FIN 358|FR FRA 33|GA GAB 241|GM GMB 220|GE GEO 995|DE DEU 49|GH GHA 233|" +
  "GR GRC 30|GD GRD 1|GT GTM 502|GN GIN 224|GW GNB 245|GY GUY 592|HT HTI 509|HN HND 504|HK HKG 852|HU HUN 36|IS ISL 354|" +
  "IN IND 91|ID IDN 62|IR IRN 98|IQ IRQ 964|IE IRL 353|IT ITA 39|JM JAM 1|JP JPN 81|JO JOR 962|KZ KAZ 7|KE KEN 254|" +
  "KI KIR 686|KW KWT 965|KG KGZ 996|LA LAO 856|LV LVA 371|LB LBN 961|LS LSO 266|LR LBR 231|LY LBY 218|LI LIE 423|LT LTU 370|" +
  "LU LUX 352|MO MAC 853|MG MDG 261|MW MWI 265|MY MYS 60|MV MDV 960|ML MLI 223|MT MLT 356|MH MHL 692|MR MRT 222|MU MUS 230|" +
  "MX MEX 52|FM FSM 691|MD MDA 373|MC MCO 377|MN MNG 976|ME MNE 382|MA MAR 212|MZ MOZ 258|MM MMR 95|NA NAM 264|NR NRU 674|" +
  "NP NPL 977|NL NLD 31|NZ NZL 64|NI NIC 505|NE NER 227|NG NGA 234|KP PRK 850|MK MKD 389|NO NOR 47|OM OMN 968|PK PAK 92|" +
  "PW PLW 680|PS PSE 970|PA PAN 507|PG PNG 675|PY PRY 595|PE PER 51|PH PHL 63|PL POL 48|PT PRT 351|PR PRI 1|QA QAT 974|" +
  "RO ROU 40|RU RUS 7|RW RWA 250|KN KNA 1|LC LCA 1|VC VCT 1|WS WSM 685|SM SMR 378|ST STP 239|SA SAU 966|SN SEN 221|" +
  "RS SRB 381|SC SYC 248|SL SLE 232|SG SGP 65|SK SVK 421|SI SVN 386|SB SLB 677|SO SOM 252|ZA ZAF 27|KR KOR 82|SS SSD 211|" +
  "ES ESP 34|LK LKA 94|SD SDN 249|SR SUR 597|SE SWE 46|CH CHE 41|SY SYR 963|TW TWN 886|TJ TJK 992|TZ TZA 255|TH THA 66|" +
  "TL TLS 670|TG TGO 228|TO TON 676|TT TTO 1|TN TUN 216|TR TUR 90|TM TKM 993|TV TUV 688|UG UGA 256|UA UKR 380|AE ARE 971|" +
  "GB GBR 44|US USA 1|UY URY 598|UZ UZB 998|VU VUT 678|VA VAT 379|VE VEN 58|VN VNM 84|YE YEM 967|ZM ZMB 260|ZW ZWE 263|XK XKX 383";

export type Country = { iso2: string; iso3: string; dial: string };
export const COUNTRIES: Country[] = RAW.split("|").map((x) => {
  const [iso2, iso3, dial] = x.split(" ");
  return { iso2, iso3, dial };
});

/** Shown first: the Gulf and the nationalities hotels in Oman see most often. */
export const PRIORITY = ["OM", "AE", "SA", "QA", "BH", "KW", "YE", "EG", "JO", "IN", "PK", "BD", "LK", "NP", "PH", "IR", "GB", "US", "DE", "FR", "IT", "RU", "CN"];

/** Where two countries share a code (+1, +7, +44), the one picked when a number is typed in full. */
const PREFERRED: Record<string, string> = { "1": "US", "7": "RU", "44": "GB" };

export const byIso2 = (iso2: string) => COUNTRIES.find((c) => c.iso2 === iso2);
export const byIso3 = (iso3: string | null | undefined) => (iso3 ? COUNTRIES.find((c) => c.iso3 === iso3.toUpperCase()) : undefined);

export function flag(iso2: string): string {
  return String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** "+96891234567" → Oman + "91234567" (longest matching code wins). */
export function splitInternational(v: string): { country: Country; national: string } | null {
  const digits = v.replace(/^\+|^00/, "");
  for (let len = 4; len >= 1; len--) {
    const code = digits.slice(0, len);
    const matches = COUNTRIES.filter((c) => c.dial === code);
    if (matches.length) {
      const country = matches.find((c) => c.iso2 === PREFERRED[code]) ?? matches[0];
      return { country, national: digits.slice(len) };
    }
  }
  return null;
}
