// Headers every API client sends (§2.7 rules 2 and 3, D3), with no import: this module also loads in a k6 script
// (`import { REQUEST_HEADERS } from '…/_kit/headers.js'`). `Sec-Fetch-Site: same-origin` is what the browser sends
// from the tool; a client outside a browser sets it by hand (otherwise a write with a cookie and no `Origin` is
// refused, and so is `/files/`).
export const REQUEST_HEADERS = Object.freeze({ 'x-requested-with': 'eupadev', 'sec-fetch-site': 'same-origin' });
