// Load on the two reads people use most: the list, then the first request of the list, one VU per realm
// person (K4), each under their own rate limit (120 reads per minute and operation: 15 lists and 15 reads per VU), the
// static headers of the kit. Thresholds: every check passes, p(95) under 300 ms per operation.
import http from 'k6/http';
import { check } from 'k6';
import { REQUEST_HEADERS } from '../../node_modules/@eupadev/core/kit/headers.js';

const COOKIES = JSON.parse(__ENV.COOKIES);

export const options = {
  scenarios: { people: { executor: 'per-vu-iterations', vus: COOKIES.length, iterations: 15 } },
  thresholds: {
    checks: ['rate==1'],
    'http_req_duration{op:listRequests}': ['p(95)<300'],
    'http_req_duration{op:getRequest}': ['p(95)<300'],
  },
};

export default function () {
  const params = (/** @type {string} */ op) => ({ headers: { ...REQUEST_HEADERS, cookie: COOKIES[(__VU - 1) % COOKIES.length] }, tags: { op } });
  const list = http.get(`${__ENV.BASE}/api/requests?limit=50`, params('listRequests'));
  const id = list.status === 200 ? list.json('items.0.id') : null;
  check(list, { 'listRequests: 200 with at least one request': () => list.status === 200 && typeof id === 'string' });
  if (typeof id !== 'string') return;
  const one = http.get(`${__ENV.BASE}/api/requests/${id}`, params('getRequest'));
  check(one, { 'getRequest: 200, the request listed': (r) => r.status === 200 && r.json('id') === id });
}
