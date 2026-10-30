// Throwaway Mailpit for the mail tests (E1): the same server as the lab (image by digest, the one of the orchestrator's
// Compose), SMTP and API ports on 127.0.0.1, removed at the end (even on failure, even on SIGINT). The received mails
// are read through its REST API, as the lab's mail verify playbook does.
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

export const IMAGE_MAILPIT = 'axllent/mailpit:v1.31.5@sha256:94f6b70c1436defae6799d9ac7ff0eeff9540465b842026d5cdb018f1c0234ea';

/** A mail as Mailpit's API summarises it (`GET /api/v1/messages`). */
export interface ReceivedMail { ID: string; MessageID: string; Subject: string; To: { Address: string }[]; Bcc: { Address: string }[]; From: { Name: string; Address: string } }

export interface ThrowawayMailpit {
  smtpUrl: string;
  mails(): Promise<ReceivedMail[]>;
  /** Raw headers of a mail (`GET /api/v1/message/<ID>/headers`). */
  headers(id: string): Promise<Record<string, string[]>>;
  empty(): Promise<void>;
  remove(): void;
}

export async function startMailpit(): Promise<ThrowawayMailpit> {
  let container = execFileSync('docker', ['run', '-d', '--rm', '-p', '127.0.0.1::1025', '-p', '127.0.0.1::8025', IMAGE_MAILPIT], { encoding: 'utf8' }).trim();
  const remove = () => {
    if (container === '') return;
    try { execFileSync('docker', ['rm', '-f', '-v', container], { stdio: 'ignore' }); } catch { /* already gone */ }
    container = '';
  };
  process.once('SIGINT', () => { remove(); process.exit(130); });
  process.once('SIGTERM', () => { remove(); process.exit(143); });
  process.once('exit', remove);
  const port = (internal: number) => execFileSync('docker', ['port', container, `${internal}/tcp`], { encoding: 'utf8' }).split('\n')[0]!.split(':').pop();
  const api = `http://127.0.0.1:${port(8025)}/api/v1`;
  const read = async <T>(path: string): Promise<T> => {
    const r = await fetch(`${api}${path}`);
    if (!r.ok) throw new Error(`Mailpit ${path}: ${r.status}`);
    return (await r.json()) as T;
  };
  const limit = Date.now() + 60_000;
  for (;;) {
    try {
      await read('/messages');
      break;
    } catch (e) {
      if (Date.now() > limit) { remove(); throw new Error(`Mailpit unreachable: ${String(e)}`); }
      await sleep(200);
    }
  }
  return {
    smtpUrl: `smtp://127.0.0.1:${port(1025)}`,
    mails: async () => (await read<{ messages: ReceivedMail[] }>('/messages?limit=500')).messages,
    headers: (id) => read(`/message/${id}/headers`),
    empty: async () => { await fetch(`${api}/messages`, { method: 'DELETE' }); },
    remove,
  };
}
