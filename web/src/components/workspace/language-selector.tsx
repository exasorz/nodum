"use client";

import type { ChangeEvent } from "react";

import { useTranslation, type Locale } from "@/lib/i18n";

type LocaleOption = {
  value: "en" | "ja";
  label: string;
};

const OPTIONS: LocaleOption[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

export function LanguageSelector() {
  const { locale, setLocale } = useTranslation();

  const handleChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const next = event.target.value;
    if (next === "en" || next === "ja") setLocale(next as Locale);
  };

  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-[13px] text-ob-muted">
        {OPTIONS.find((o) => o.value === locale)?.label ?? locale}
      </span>
      <select
        value={locale}
        onChange={handleChange}
        aria-label="Language"
        className="rounded-md border border-ob-border bg-ob-primary px-2 py-1 text-[13px] text-ob-text"
      >
        {OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
