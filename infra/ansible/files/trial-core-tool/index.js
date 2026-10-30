// Throwaway stand-in for a core tool (verify-deployer-core.yml): NOT the
// core. It reads the same variables as @eupadev/core (src/db.js,
// src/auth.js, src/index.js) and, like it, does not start without the OIDC
// discovery of its issuer (through HTTPS_PROXY); /health needs the database.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import pg from 'pg';

const env = process.env;
const read = (v) => readFileSync(env[v], 'utf8').trim();
const pool = new pg.Pool({ connectionString: read('DATABASE_URL_FILE'), ssl: { ca: read('DATABASE_CA_FILE') }, max: 2 });
const oidc = await (await fetch(`${env.OIDC_ISSUER}/.well-known/openid-configuration`)).json();

http.createServer(async (req, res) => {
  try {
    if (req.url === '/health') {
      await pool.query('SELECT count(*) FROM app.trial');
      res.end('ok');
    } else if (req.url === '/check') {
      const db = (await pool.query('SELECT current_user AS role, count(*)::int AS rows FROM app.trial')).rows[0];
      // A made-up code: Keycloak answers invalid_grant only once the client secret is accepted.
      const token = await fetch(oidc.token_endpoint, {
        method: 'POST',
        body: new URLSearchParams({ grant_type: 'authorization_code', code: 'x', redirect_uri: `${env.APP_URL}/auth/callback`,
          client_id: env.OIDC_CLIENT_ID, client_secret: read('OIDC_CLIENT_SECRET_FILE') }),
      });
      let other = 'reached';
      try { await fetch('https://example.com/', { signal: AbortSignal.timeout(5000) }); } catch { other = 'refused'; }
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ db, oidc: (await token.json()).error ?? 'none', other, client: env.OIDC_CLIENT_ID,
        app: env.APP_URL, trust: env.TRUST_PROXY }));
    } else {
      res.statusCode = 404;
      res.end();
    }
  } catch (e) {
    console.error(`${req.url}: ${e}`);
    res.statusCode = 500;
    res.end(String(e));
  }
}).listen(3000);
