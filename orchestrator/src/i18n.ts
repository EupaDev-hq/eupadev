/**
 * End-user texts of the engine (ADR-025): the requester's chat messages, the mails, the reasons shown to the admin
 * at a gate. One dictionary per language (`lang/en.json`, `lang/fr.json`, English keys, the same keys in both, checked by
 * `tests/i18n.test.ts`); the deployment chooses the language (`EUPADEV_LANGUAGE`, English by default, French on the
 * lab). `{name}` is replaced by `values.name`. Messages for developers and operators (logs, errors, database refusals)
 * stay English and never go through here.
 */
import { readFileSync } from 'node:fs';

export const LANGUAGES = ['en', 'fr'] as const;
export type Language = (typeof LANGUAGES)[number];
export type Values = Record<string, string | number>;

const load = (language: Language): Record<string, string> =>
  JSON.parse(readFileSync(new URL(`../lang/${language}.json`, import.meta.url), 'utf8')) as Record<string, string>;
export const DICTIONARIES: Readonly<Record<Language, Readonly<Record<string, string>>>> = { en: load('en'), fr: load('fr') };

/** The text of `key` in `language`, its `{name}` placeholders filled; an unknown key is a bug (thrown). */
export function text(language: Language, key: string, values: Values = {}): string {
  const template = DICTIONARIES[language][key] ?? DICTIONARIES.en[key];
  if (template === undefined) throw new Error(`unknown text key: ${key}`);
  return template.replace(/\{(\w+)\}/g, (all, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : all));
}
