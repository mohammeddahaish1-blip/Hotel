import Link from "next/link";

const TABS = [
  ["overview", "نظرة عامة", "/admin/finance"],
  ["payments", "الدفعات", "/admin/payments"],
  ["expenses", "المصروفات", "/admin/finance?v=expenses"],
  ["rates", "أسعار الصرف", "/admin/finance?v=rates"],
] as const;

/** The finance section's own tabs: overview, subscription payments, the team's expenses, exchange rates. */
export function FinanceTabs({ on }: { on: (typeof TABS)[number][0] }) {
  return (
    <nav className="mb-5 flex max-w-full gap-1 overflow-x-auto rounded-full bg-gray-soft p-1" aria-label="أقسام المالية">
      {TABS.map(([k, label, href]) => (
        <Link key={k} href={href} aria-current={on === k ? "page" : undefined}
          className={`shrink-0 rounded-full px-4 py-2 text-sm font-semibold ${on === k ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>{label}</Link>
      ))}
    </nav>
  );
}
