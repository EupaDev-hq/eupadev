// Test cases of the template's Opengrep rules (tool-template/.opengrep/).
// Outside the template: this file is neither copied into the tools nor
// analysed by their CI (it would be flagged there). Run from the repository root:
//   opengrep --test --config tool-template/.opengrep/starter-rules.yml tests/opengrep/starter-rules.js
// (file by file: in test mode, a hidden directory given as --config is ignored).

// --- cookie-no-host-prefix: flagged ---
// ruleid: cookie-no-host-prefix
res.setHeader('Set-Cookie', 'session=abc; HttpOnly; Secure; SameSite=Lax; Path=/');
// ruleid: cookie-no-host-prefix
res.setHeader('set-cookie', `session=${id}; HttpOnly; Secure; Path=/`);
// ruleid: cookie-no-host-prefix
res.appendHeader('Set-Cookie', `__Host-session=${id}; Secure; Path=/; Domain=example.org`);
// ruleid: cookie-no-host-prefix
res.setHeader('Set-Cookie', `__Host-session=${id}; Secure; Path=/; domain=${domain}`);
// ruleid: cookie-no-host-prefix
res.setHeader('Set-Cookie', cookie);
// ruleid: cookie-no-host-prefix
res.setHeader('Set-Cookie', ['__Host-a=1; Secure; Path=/', 'b=2']);
// ruleid: cookie-no-host-prefix
res.writeHead(302, { Location: '/', 'Set-Cookie': `session=${id}; Secure; Path=/` });
// ruleid: cookie-no-host-prefix
headers.append('Set-Cookie', 'session=abc; Secure; Path=/');
// ruleid: cookie-no-host-prefix
new Response(null, { status: 302, headers: { 'Set-Cookie': 'session=abc; Secure; Path=/' } });
// ruleid: cookie-no-host-prefix
document.cookie = 'theme=dark; Secure; Path=/';
// ruleid: cookie-no-host-prefix
document.cookie = `__Host-theme=${t}; Secure; Path=/; Domain=example.org`;
// ruleid: cookie-no-host-prefix
document.cookie = cookie;
// ruleid: cookie-no-host-prefix
cookieStore.set('theme', 'dark');
// ruleid: cookie-no-host-prefix
cookieStore.set({ name: '__Host-theme', value: 'dark', domain: 'example.org' });

// --- cookie-no-host-prefix: accepted ---
// ok: cookie-no-host-prefix
res.setHeader('Set-Cookie', `__Host-session=${id}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${duration}`);
// ok: cookie-no-host-prefix
res.appendHeader('Set-Cookie', '__Host-session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0');
// ok: cookie-no-host-prefix
res.writeHead(302, { Location: '/', 'Set-Cookie': `__Host-session=${id}; HttpOnly; Secure; Path=/` });
// ok: cookie-no-host-prefix
headers.set('Set-Cookie', '__Host-session=abc; Secure; Path=/');
// ok: cookie-no-host-prefix
res.setHeader('Content-Type', 'text/html; charset=utf-8');
// ok: cookie-no-host-prefix
res.setHeader(name, value);
// ok: cookie-no-host-prefix
fetch(url, { headers: { Cookie: 'session=abc' } });
// ok: cookie-no-host-prefix
document.cookie = `__Host-theme=${t}; Secure; SameSite=Lax; Path=/`;
// ok: cookie-no-host-prefix
cookieStore.set('__Host-theme', 'dark');
// ok: cookie-no-host-prefix
const cookies = document.cookie;

// --- system-command-variable-text: flagged ---
function viaRequire(cmd) {
  const cp = require('child_process');
  // ruleid: system-command-variable-text
  cp.exec(cmd);
  // ruleid: system-command-variable-text
  cp.execSync(`ls ${cmd}`, { stdio: 'inherit' });
}
function viaRequireNode(cmd) {
  const cp = require('node:child_process');
  // ruleid: system-command-variable-text
  cp.exec(cmd, () => {});
}
function viaDirectRequire(cmd) {
  // ruleid: system-command-variable-text
  require('child_process').exec(cmd);
  // ruleid: system-command-variable-text
  require('node:child_process').execSync(cmd);
}
function viaDestructuredRequire(cmd) {
  const { exec, execSync } = require('child_process');
  // ruleid: system-command-variable-text
  exec(cmd);
  // ruleid: system-command-variable-text
  execSync(cmd);
  // ok: system-command-variable-text
  execSync('git status');
}

// --- system-command-variable-text: accepted ---
function notChildProcess(t, re) {
  const cp = { exec: (x) => x };
  // ok: system-command-variable-text
  cp.exec(t);
  // ok: system-command-variable-text
  /x/.exec(t);
  // ok: system-command-variable-text
  re.exec(t);
  const cp2 = require('child_process');
  // ok: system-command-variable-text
  cp2.exec('git status');
  // ok: system-command-variable-text
  cp2.execFile('git', [t]);
}

// --- system-command-variable-text: ES imports (top level, so last) ---
import cpDefault from 'child_process';
import * as cpNamespace from 'node:child_process';
import { exec, execSync } from 'child_process';
// ruleid: system-command-variable-text
cpDefault.exec(command);
// ruleid: system-command-variable-text
cpNamespace.execSync(command);
// ruleid: system-command-variable-text
exec(command, () => {});
// ruleid: system-command-variable-text
execSync(`rm ${command}`);
// ok: system-command-variable-text
cpDefault.exec('ls -l');
// ok: system-command-variable-text
execSync('ls -l');
// ok: system-command-variable-text
/^v(\d+)/.exec(command);
