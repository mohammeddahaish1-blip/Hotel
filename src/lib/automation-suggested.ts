import type { DictKey } from "./i18n/dict";

/** Ready-made rules offered on the Automation page; each can be turned on by itself. */
export const SUGGESTED_RULES: { key: string; name: DictKey; trigger: string; offset_days: number; action: string; template_key: string | null; hk_kind?: string }[] = [
  { key: "confirm", name: "auto_sug_confirm", trigger: "booking_confirmed", offset_days: 0, action: "whatsapp", template_key: "booking_confirmed" },
  { key: "prearrival", name: "auto_sug_prearrival", trigger: "before_arrival", offset_days: 1, action: "whatsapp", template_key: "pre_arrival" },
  { key: "thanks", name: "auto_sug_thanks", trigger: "after_checkout", offset_days: 0, action: "whatsapp", template_key: "checkout_thanks" },
  { key: "rent", name: "auto_sug_rent", trigger: "rent_overdue", offset_days: 3, action: "whatsapp", template_key: "payment_request" },
  { key: "rent_notice", name: "auto_sug_rent_notice", trigger: "rent_overdue", offset_days: 7, action: "notify", template_key: null },
  { key: "contract", name: "auto_sug_contract", trigger: "contract_ending", offset_days: 30, action: "whatsapp", template_key: "contract_renewal" },
  { key: "weekly", name: "auto_sug_weekly", trigger: "after_checkin", offset_days: 7, action: "hk_task", template_key: null, hk_kind: "weekly" },
];
