/**
 * C1 (A-R6, decision D2, note `docs/reflexions/2026-10-21-note-a-r6.md` §4): the scoping role's `requester_message` is
 * the only agent text a requester reads. A technical word in it fails the scoping task with the word as reason, and the
 * task is sent back with that reason (`scopingFailure`). Whole words, any case, accents included; plurals too. The
 * refused words are listed per language (`jargon.words` of `lang/*.json`, L10); a message is checked against all of
 * them, whatever the deployment's language.
 * ponytail: fixed lists, tuned by a reviewed change; no judgement of plain language (governance D25).
 */
import { DICTIONARIES, LANGUAGES } from '../i18n.ts';

const WORDS = [...new Set(LANGUAGES.flatMap((l) => (DICTIONARIES[l]['jargon.words'] ?? '').split(',').map((w) => w.trim()).filter((w) => w !== '')))];
const JARGON = new RegExp(`(?<![\\p{L}\\p{N}_])(?:(?:${WORDS.join('|')})s?|code\\s+[45]\\d\\d)(?![\\p{L}\\p{N}_])`, 'iu');

/** First refused word of `text`, as written, or null. */
export function jargon(text: string): string | null {
  return JARGON.exec(text)?.[0] ?? null;
}
