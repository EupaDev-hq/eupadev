// The Preview personas (secret PREVIEW_PERSONAS: [{name, password, roles}], written at Gate 1 by register-tools.yml)
// as the realm-shaped file the kit's readRealm reads (KIT_REALM_FILE): one group per role carrying that client role
// of `trial-tool`, a stub client. Run by acceptance.sh; protected (.gitea/**). Usage: node realm-personas.mjs <file>
import { writeFileSync } from 'node:fs';

const personas = JSON.parse(process.env.PREVIEW_PERSONAS ?? '[]');
if (!Array.isArray(personas) || personas.length === 0) throw new Error('PREVIEW_PERSONAS: no persona');
const roles = [...new Set(personas.flatMap((p) => p.roles))];
writeFileSync(process.argv[2], JSON.stringify({
  clients: [{ clientId: 'trial-tool', secret: '' }],
  groups: roles.map((r) => ({ name: `role-${r}`, clientRoles: { 'trial-tool': [r] } })),
  users: personas.map((p) => ({ username: p.name, credentials: [{ value: p.password }], groups: p.roles.map((r) => `/role-${r}`) })),
}), { mode: 0o600 });
