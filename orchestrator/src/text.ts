/**
 * Invisible or control characters ("Rules File Backdoor", Pillar 2025; instructions note, correction 6): refused in any
 * text that reaches the trusted channel — role instructions at build time, the comment of a gate decision (hence the
 * catalogue description), names of files pushed by an agent. C0 and C1 except tab and line feed, zero-width
 * (U+200B-200F), separators and bidi controls (U+2028-202E, U+2066-2069), U+2060-2064, BOM (U+FEFF), Unicode tags
 * (U+E0000-E007F). Ranges written as numbers: no literal invisible character in this source.
 */
const RANGES: [number, number][] = [
  [0x0000, 0x0008], [0x000b, 0x001f], [0x007f, 0x009f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064],
  [0x2066, 0x2069], [0xfeff, 0xfeff], [0xe0000, 0xe007f],
];
const INVISIBLE = new RegExp(`[${RANGES.map(([a, b]) => `\\u{${a.toString(16)}}-\\u{${b.toString(16)}}`).join('')}]`, 'u');

/** First invisible character of the text (`U+200B at position 12`), or null if there is none. */
export function invisibleCharacter(text: string): string | null {
  const m = INVISIBLE.exec(text);
  if (m === null) return null;
  return `U+${m[0].codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')} at position ${m.index}`;
}
