import type { en } from "./locales/en";

type Widen<T> = T extends string
  ? string
  : T extends readonly unknown[]
    ? T
    : T extends object
      ? { [K in keyof T]: Widen<T[K]> }
      : T;

export type Locale = "en" | "ja";

/** Translation values share the English tree, but each locale may contain any string. */
export type Translations = Widen<typeof en>;

export type TranslationKey = NestedKeyOf<typeof en>;

export type InterpolationParams = Record<string, string | number | undefined>;

type NestedKeyOf<ObjectType extends object> = {
  [Key in keyof ObjectType & (string | number)]: ObjectType[Key] extends object
    ? ObjectType[Key] extends readonly unknown[]
      ? `${Key}`
      : `${Key}` | `${Key}.${NestedKeyOf<ObjectType[Key]>}`
    : `${Key}`;
}[keyof ObjectType & (string | number)];
