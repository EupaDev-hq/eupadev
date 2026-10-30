// k6 script of the kit's bench (tests/kit.test.js): the shape a tool gives to tests/perf/load.k6.js. Static
// headers imported from the kit; one VU per person of the test realm (sessions in __ENV.COOKIES), each under their
// own rate limit (20 a minute): 15 requests per VU, 45 in all, all at 200 (note K4). A single person sending 45
// requests would get 429 from the 21st.
import http from 'k6/http';
import { check } from 'k6';
import { REQUEST_HEADERS } from '../kit/headers.js';

const COOKIES = JSON.parse(__ENV.COOKIES);

export const options = {
  scenarios: { people: { executor: 'per-vu-iterations', vus: COOKIES.length, iterations: 15 } },
  thresholds: { checks: ['rate==1'] },
};

export default function () {
  const r = http.get(`${__ENV.BASE}/api/items`, { headers: { ...REQUEST_HEADERS, cookie: COOKIES[(__VU - 1) % COOKIES.length] } });
  check(r, { 'GET /api/items: 200 (static headers and the person\'s session accepted)': (x) => x.status === 200 });
}
