"use client";

import { useTranslation, type Locale } from "@/lib/i18n";

const OPTIONS: Array<{ value: Locale; label: string }> = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

export function LanguageSelector() {
  const { locale, setLocale, t } = useTranslation();

  return (
    <select
      value={locale}
      onChange={(event) => setLocale(event.target.value as Locale)}
      aria-label={t("languageSelector.language")}
      className="w-full rounded-md border border-ob-border bg-ob-primary px-2 py-1.5 text-[13px] text-ob-text sm:w-40"
    >
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
