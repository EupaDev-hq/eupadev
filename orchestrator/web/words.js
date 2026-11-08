/**
 * Words that say yes, in English and French, and the small words found around them (the thing approved, the halves of
 * an elision split at the apostrophe). A message made only of these, with at least one yes, is an acceptance; one other
 * word ("ok but…", "not fine") and it is not. No grammar: the question that follows is the safety net.
 *
 * The engine's fake intent reader (`src/intent.ts`, ADR-031) is built from it: the test double of the model, nothing the
 * page reads itself. Kept with the page's files, imported by Node as a plain ES module.
 */
export const YES = new Set('ok okay yes yep yeah oui accepted approve approved valid valide validee validated good great fine perfect parfait parfaite nice nickel impeccable impec super top bon bonne bien lgtm satisfied satisfait satisfaite convient accord va plait marche works go'.split(' '));
export const FILLER = new Set('the this that it its is all everything looks look seems to me for very really so and well thanks preview mockup mock up la le c d s est ca tout tres vraiment moi maquette comme pour merci'.split(' '));
/** The words of a sentence: lower case, accents stripped, split on anything that is not a letter or a digit. */
export const words = (text) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean);
export function accepted(text) {
  const w = words(text);
  return w.some((x) => YES.has(x)) && w.every((x) => YES.has(x) || FILLER.has(x));
}
