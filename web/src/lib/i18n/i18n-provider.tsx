"use client";

import { createContext, useCallback, useEffect, useMemo, useState } from "react";

import { en } from "./locales/en";
import { ja } from "./locales/ja";
import type { Locale, Translations } from "./types";

const STORAGE_KEY = "nodum:locale";

const DEFAULT_LOCALE: Locale = "en";

const LOCALES: Record<Locale, Translations> = {
  en,
  ja,
};

function isLocale(value: string): value is Locale {
  return value in LOCALES;
}

function readStoredLocale(): Locale | null {
  if (typeof window === "undefined") return null;
  const stored = window.localStorage.getItem(STORAGE_KEY);
  return stored && isLocale(stored) ? stored : null;
}

export interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  translations: Translations;
}

export const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale() ?? DEFAULT_LOCALE);

  useEffect(() => {
    const stored = readStoredLocale();
    if (stored && stored !== locale) setLocaleState(stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(STORAGE_KEY, locale);
    }
  }, [locale]);

  const value = useMemo(
    () => ({ locale, setLocale, translations: LOCALES[locale] }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
