// Mailpit of the test Compose (K8), read through its API: what the tool sent, to whom, with which text. `base` is the
// published API address (`docker compose port mailpit 8025`).

/** @typedef {{ id: string, to: string[], subject: string, text: string }} Mail */

/** @param {string} base e.g. `http://127.0.0.1:49153` */
export function mailpit(base) {
  /** @param {string} path @param {RequestInit} [init] @returns {Promise<any>} */
  const call = async (path, init) => {
    const r = await fetch(`${base}${path}`, init);
    if (!r.ok) throw new Error(`Mailpit ${path}: ${r.status}`);
    return (r.headers.get('content-type') ?? '').includes('json') ? r.json() : null;
  };
  /** Every message, newest first, with its plain text. @returns {Promise<Mail[]>} */
  const list = async () => {
    const { messages } = await call('/api/v1/messages?limit=500');
    return Promise.all(messages.map(async (/** @type {any} */ m) => ({
      id: m.ID,
      to: m.To.map((/** @type {{ Address: string }} */ a) => a.Address),
      subject: m.Subject,
      text: (await call(`/api/v1/message/${m.ID}`)).Text,
    })));
  };
  return {
    list,
    /**
     * Waits until a message matches `test`: mail leaves after the change is committed, not before the answer.
     * @param {(m: Mail) => boolean} test @param {number} [ms]
     */
    async waitFor(test, ms = 10_000) {
      const end = Date.now() + ms;
      for (;;) {
        const found = (await list()).find(test);
        if (found) return found;
        if (Date.now() > end) throw new Error('Mailpit: no matching message');
        await new Promise((r) => { setTimeout(r, 200); });
      }
    },
    /** Deletes every message. */
    clear: () => call('/api/v1/messages', { method: 'DELETE' }),
  };
}
