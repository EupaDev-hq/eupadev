// Memory of the example tool (the HTTP tests have no database); `api/lib/` is not loaded by the core.
/** @type {Map<string, { id: string, name: string, status: string }>} */
export const items = new Map();

/** Last stream returned by `exportItems?trap=type`: the test checks that the core destroyed it. @type {{ stream: import('node:stream').Readable | null }} */
export const witness = { stream: null };

/** Identifiers that trigger a faulty behaviour, to test that the core contains it. */
export const TRAPS = {
  outsideContract: '00000000-0000-0000-0000-00000000bad0',
  exception: '00000000-0000-0000-0000-000000000500',
  forbiddenHeader: '00000000-0000-0000-0000-000000000ead',
  undeclaredStatus: '00000000-0000-0000-0000-000000000418',
};

/** Files uploaded by putItemAttachment, by item id. @type {Map<string, { type: string, body: Buffer }>} */
export const files = new Map();
