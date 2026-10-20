"use client";

import { useState } from "react";

export type Datum = { key: string; label: string; value: number; display: string };

/**
 * Vertical bars for a single series over time (time runs left → right).
 * Thin bars with 4px rounded tops, 2px gaps, a recessive grid, labels on the
 * peak and latest bars only, and a hover tooltip on a full-height hit area.
 */
export function ColumnChart({
  data,
  max,
  ticks,
  height = 220,
  tableLabel,
  columns,
}: {
  data: Datum[];
  max?: number;
  ticks: { value: number; label: string }[];
  height?: number;
  tableLabel: string;
  columns: [string, string];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const top = Math.max(max ?? 0, ...data.map((d) => d.value), 1);
  const peak = data.reduce((best, d, i) => (d.value > data[best].value ? i : best), 0);
  const labelled = new Set([peak, data.length - 1]);

  return (
    <div>
      <div dir="ltr" className="relative" style={{ height }}>
        {/* grid + y labels */}
        {ticks.map((t) => (
          <div key={t.value} className="absolute inset-x-0 border-t border-grid" style={{ bottom: `${(t.value / top) * 100}%` }}>
            <span className="absolute -top-2.5 left-0 bg-surface pe-1 text-[10px] text-muted">{t.label}</span>
          </div>
        ))}
        <div className="absolute inset-0 flex items-end gap-[2px] pl-10">
          {data.map((d, i) => {
            const h = d.value <= 0 ? 0 : Math.max((d.value / top) * 100, 1.5);
            // keep labels inside the plot at both edges
            const anchor = i === data.length - 1 ? "right-0" : i === 0 ? "left-0" : "left-1/2 -translate-x-1/2";
            return (
              <div
                key={d.key}
                className="relative flex h-full flex-1 items-end"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${d.label}: ${d.display}`}
              >
                <div
                  className={`w-full rounded-t-[4px] bg-chart transition-opacity ${hover !== null && hover !== i ? "opacity-40" : ""}`}
                  style={{ height: `${h}%` }}
                />
                {labelled.has(i) && d.value > 0 && hover === null ? (
                  <span dir="auto" className={`num absolute ${anchor} whitespace-nowrap rounded bg-surface/90 px-0.5 text-[10px] font-semibold text-ink`} style={{ bottom: `calc(${h}% + 4px)` }}>
                    {d.display}
                  </span>
                ) : null}
                {hover === i ? (
                  <div
                    dir="auto"
                    className={`pointer-events-none absolute z-10 ${anchor} whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg`}
                    style={{ bottom: `calc(${h}% + 8px)` }}
                  >
                    <div className="text-muted">{d.label}</div>
                    <div className="num font-bold text-ink">{d.display}</div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      {/* x labels: first, middle, last */}
      <div dir="ltr" className="mt-1 flex justify-between pl-10 text-[10px] text-muted">
        <span>{data[0]?.label}</span>
        <span>{data[Math.floor(data.length / 2)]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>
      <DataTable data={data} label={tableLabel} columns={columns} />
    </div>
  );
}

/** Horizontal bars for comparing categories (sorted by the caller); value printed at the end. */
export function BarList({ data, tableLabel, columns }: { data: Datum[]; tableLabel: string; columns: [string, string] }) {
  const top = Math.max(...data.map((d) => d.value), 1);
  return (
    <div>
      <ul className="space-y-2.5">
        {data.map((d) => (
          <li key={d.key} className="grid grid-cols-[minmax(5rem,8rem)_1fr_6.5rem] items-center gap-3 text-sm" title={`${d.label}: ${d.display}`}>
            <span className="truncate text-ink">{d.label}</span>
            <span className="h-3 rounded-[4px] bg-gray-soft">
              <span className="block h-3 rounded-[4px] bg-chart" style={{ width: `${d.value <= 0 ? 0 : Math.max((d.value / top) * 100, 1)}%` }} />
            </span>
            <span dir="auto" className="num text-xs font-semibold text-ink">{d.display}</span>
          </li>
        ))}
      </ul>
      <DataTable data={data} label={tableLabel} columns={columns} />
    </div>
  );
}

function DataTable({ data, label, columns }: { data: Datum[]; label: string; columns: [string, string] }) {
  return (
    <details className="mt-3 text-xs">
      <summary className="cursor-pointer text-muted">{label}</summary>
      <table className="table mt-2">
        <thead>
          <tr><th>{columns[0]}</th><th>{columns[1]}</th></tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}><td>{d.label}</td><td dir="auto" className="num">{d.display}</td></tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
