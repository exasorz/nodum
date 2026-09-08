import type { EnTranslations } from "./locales/en";

export type Locale = "en" | "ja";

export type Translations = EnTranslations;

export type TranslationKey = NestedKeyOf<EnTranslations>;

export type InterpolationParams = Record<string, string | number | undefined>;

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? ObjectType[Key] extends readonly unknown[]
      ? `${Key}`
      : `${Key}` | `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];
