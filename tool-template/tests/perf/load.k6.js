// Named .k6.js (not *-test.js): otherwise `node --test` takes it for a Node
// test and fails — a generated Node tool would have had its tests broken.
// Minimal perf test — k6 (lightweight/scriptable, suited to a
// constrained deployment target). Example to adapt by the agent that
// generates the actual tool: replace /health with the tool's actually
// critical routes (the ones that make DB queries, not just a static
// healthcheck).
//
// k6 chosen "for now" — if the volume/complexity of generated tools
// justifies it, consider a more complete tool later (e.g. Grafana k6
// Cloud, Gatling) — not a fixed choice.
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 10,
  duration: '30s',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // TARGET_URL = base URL of the deployed Preview (given by the Preview pipeline).
  const res = http.get(`${__ENV.TARGET_URL || 'http://localhost:3000'}/health`);
  check(res, { 'status is 200': (r) => r.status === 200 });
  sleep(1);
}
