"use client";

/** A select inside a GET form that applies as soon as a choice is made (no extra button). */
export function FilterSelect({ name, label, value, options }: { name: string; label: string; value: string; options: [string, string][] }) {
  return (
    <select
      name={name}
      aria-label={label}
      defaultValue={value}
      className="input w-auto min-w-0 flex-1 py-2 sm:flex-none"
      onChange={(e) => e.currentTarget.form?.requestSubmit()}
    >
      {options.map(([v, text]) => (
        <option key={v} value={v}>{text}</option>
      ))}
    </select>
  );
}
