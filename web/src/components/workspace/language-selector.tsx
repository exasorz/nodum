"use client";

import { useTranslation, type Locale } from "@/lib/i18n";

type LocaleOption = {
  value: Locale;
  label: string;
};

const OPTIONS: LocaleOption[] = [
  { value: "en", label: "English" },
  { value: "ja", label: "日本語" },
];

export function LanguageSelector() {
  const { locale, setLocale } = useTranslation();

  return (
    <div className="flex items-center gap-1 rounded-md border border-ob-border bg-ob-primary p-1">
      {OPTIONS.map((option) => {
        const selected = option.value === locale;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => setLocale(option.value)}
            className={
              selected
                ? "rounded px-2.5 py-1 text-[13px] text-ob-text bg-ob-active"
                : "rounded px-2.5 py-1 text-[13px] text-ob-muted hover:bg-ob-hover hover:text-ob-text"
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
