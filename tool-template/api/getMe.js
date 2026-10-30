// The caller's roles (placeholder operation of the template, replaced at Scoping).
/** @param {any} ctx */
export default async function getMe(ctx) {
  return { status: 200, body: { roles: ctx.session.roles } };
}
