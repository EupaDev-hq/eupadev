// The caller: display name from the actor table, roles from the session.
/** @param {any} ctx */
export default async function getMe(ctx) {
  const { rows: [actor] } = await ctx.db.tx((/** @type {any} */ t) => t.query(
    'SELECT id, display_name AS name FROM actors WHERE id = $1', [ctx.session.actorId]));
  return { status: 200, body: { id: actor.id, name: actor.name, roles: ctx.session.roles } };
}
