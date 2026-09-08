"use client";

import { useCallback, useContext } from "react";

import { I18nContext } from "./i18n-provider";
import type { InterpolationParams, Locale, TranslationKey } from "./types";

export function useTranslation() {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useTranslation must be used within an I18nProvider");
  }
  const { locale, setLocale, translations } = ctx;

  const t = useCallback(
    (key: TranslationKey, params?: InterpolationParams): string => {
      const value = getNestedValue(translations, key);
      if (typeof value !== "string") return key;
      return interpolate(value, params);
    },
    [translations],
  );

  return { t, locale, setLocale };
}

function getNestedValue(obj: Record<string, unknown>, key: string): unknown {
  const parts = key.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function interpolate(template: string, params?: InterpolationParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_match, name: string) => {
    const value = params[name];
    return value === undefined ? `{${name}}` : String(value);
  });
}

export function useLocale(): {
  locale: Locale;
  setLocale: (locale: Locale) => void;
} {
  const ctx = useContext(I18nContext);
  if (!ctx) {
    throw new Error("useLocale must be used within an I18nProvider");
  }
  return { locale: ctx.locale, setLocale: ctx.setLocale };
}
