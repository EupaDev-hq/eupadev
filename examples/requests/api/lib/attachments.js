// Who may change a request's attachment: the author while the request is a draft or submitted; a manager
// uploads on any request they see; an administrator uploads and removes on any request they see.

/** Statuses in which the author still changes the attachment. */
export const AUTHOR_EDITABLE = ['draft', 'submitted'];

/**
 * Reason to refuse an attachment change, or null.
 * @param {{ author: boolean, roles: string[], status: string, remove: boolean }} c
 * @returns {[number, string, string] | null} HTTP status, code, detail
 */
export function attachmentRefusal({ author, roles, status, remove }) {
  if (roles.includes('admin') || (!remove && roles.includes('manager'))) return null;
  if (!author) return [403, 'FORBIDDEN', 'Not allowed to change this attachment'];
  if (!AUTHOR_EDITABLE.includes(status)) return [422, 'NOT_EDITABLE', `The attachment of a ${status} request no longer changes`];
  return null;
}
