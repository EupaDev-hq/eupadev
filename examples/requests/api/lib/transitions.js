// Who may ask for which status. The legality of the (from, to) pair and the history stay in the database
// (trigger requests_transition): here only what the database does not know, the caller's role and ownership.

/** Statuses only the author asks for; the others are kept for whoever manages (manager, admin). */
const BY_AUTHOR = ['submitted', 'cancelled'];
/** Statuses that require a closing note (reason for rejection, resolution note); no other accepts one. */
const WITH_NOTE = ['resolved', 'rejected'];

/**
 * Reason to refuse a transition before trying it in the database, or null.
 * @param {{ author: boolean, manages: boolean, from: string, to: string, note: string | null }} t
 * @returns {[number, string, string] | null} HTTP status, code, detail
 */
export function transitionRefusal({ author, manages, from, to, note }) {
  if (to === from) return [422, 'INVALID_TRANSITION', `Request is already ${from}`];
  if (BY_AUTHOR.includes(to) ? !author : !manages) return [403, 'FORBIDDEN', `Not allowed to set status ${to}`];
  if (WITH_NOTE.includes(to) && note === null) return [422, 'NOTE_REQUIRED', `Status ${to} requires a note`];
  if (!WITH_NOTE.includes(to) && note !== null) return [422, 'NOTE_UNEXPECTED', `Status ${to} takes no note`];
  return null;
}
