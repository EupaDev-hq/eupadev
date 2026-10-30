// Network probe of verify-agents.yml, run INSIDE a trial container (Node
// only, no dependency). Exit code 0 = reached, 1 = refused/unreachable.
//   node network-probe.js direct <host> <port>              direct TCP connection
//   node network-probe.js proxy <proxy> <port> <host:port>  CONNECT through the proxy
//   node network-probe.js listen <port>                     TCP listener (endless)
//   node network-probe.js http <url> [JSON body]            request to the AI API
//     with the key of $ANTHROPIC_API_KEY (fake: the AI proxy puts the real one);
//     GET without a body, POST with one; prints the status then the body.
const net = require('net');

const [mode, host, port, target] = process.argv.slice(2);
const finish = (ok, text) => { console.log(text); process.exit(ok ? 0 : 1); };

if (mode === 'listen') {
  net.createServer((s) => { s.on('error', () => {}); s.end('here\n'); }).listen(Number(host));
} else if (mode === 'http') {
  fetch(host, {
    method: port ? 'POST' : 'GET',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: port,
    signal: AbortSignal.timeout(30000),
  }).then(async (r) => finish(r.ok, `${r.status}\n${await r.text()}`),
    (e) => finish(false, `unreachable (${e.cause?.code || e.message})`));
} else {
  const sock = net.connect({ host, port: Number(port), timeout: 5000 });
  sock.on('timeout', () => finish(false, 'unreachable (timeout)'));
  sock.on('error', (e) => finish(false, `unreachable (${e.code || e.message})`));
  if (mode === 'direct') {
    sock.on('connect', () => finish(true, 'reached'));
  } else if (mode === 'proxy') {
    let received = '';
    sock.on('connect', () => sock.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    sock.on('data', (d) => {
      received += d;
      if (!received.includes('\r\n\r\n')) return;
      const status = received.split(' ')[1];
      const reason = (received.match(/^X-Smokescreen-Error: (.*)$/mi) || [])[1] || '';
      finish(status === '200', `${status} ${reason}`.trim());
    });
  } else {
    finish(false, `unknown mode: ${mode}`);
  }
}
