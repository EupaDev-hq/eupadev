// End-user texts of the core's front modules: one dictionary per language (`lang/en.json`, `lang/fr.json`, English
// keys), chosen by the page's `lang` attribute (`<html lang="fr">`), English otherwise. `{name}` is replaced by
// `values.name`. Fetched once at load, like the engine's page: JSON module imports (`with { type: 'json' }`) are
// missing from browsers still common in companies (Firefox ESR before 138). Under Node (unit tests of a tool),
// `fetch` cannot read a `file:` URL: the file is read from disk.
const load = async (/** @type {string} */ l) => {
  const url = new URL(`./lang/${l}.json`, import.meta.url);
  const text = url.protocol === 'file:'
    ? globalThis.process.getBuiltinModule('node:fs').readFileSync(url, 'utf8')
    : await (await fetch(url)).text();
  return /** @type {Record<string, string>} */ (JSON.parse(text));
};
const [en, fr] = await Promise.all([load('en'), load('fr')]);
/** @type {Record<string, Record<string, string>>} */
const DICTIONARIES = { en, fr };

/**
 * @param {string} key
 * @param {Record<string, string | number>} [values]
 */
export function t(key, values = {}) {
  const lang = (globalThis.document?.documentElement.lang ?? '').slice(0, 2).toLowerCase();
  const text = DICTIONARIES[lang]?.[key] ?? en[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
}
