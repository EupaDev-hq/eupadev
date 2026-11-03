// Reading one request and the scope of each person, shared by the request handlers.
// Dates as ISO 8601 text from the database (microseconds included: the cursor of listRequests compares them as is).

export const SELECTION = `SELECT r.id, d.title, d.description, d.location, d.closing_note, r.category_code AS category, r.urgency, r.status,
  r.requester_id, a.display_name AS requester_name, to_json(r.created_at) #>> '{}' AS created_at,
  to_json(r.updated_at) #>> '{}' AS updated_at, r.version::int AS version
  FROM requests r JOIN request_details d ON d.request_id = r.id JOIN actors a ON a.id = r.requester_id`;

/** Scope of the caller ($1: their actor, $2: manager or admin): their own, or any non-draft if they manage. */
export const SCOPE = "(r.requester_id = $1 OR ($2 AND r.status <> 'draft'))";
/** Visible: not deleted and within the scope. */
export const VISIBLE = `r.deleted_at IS NULL AND ${SCOPE}`;

/** The first two values of every query that uses `SCOPE` or `VISIBLE`. @param {{ actorId: string, roles: string[] }} session */
export const scope = (session) => [session.actorId, session.roles.includes('manager') || session.roles.includes('admin')];
