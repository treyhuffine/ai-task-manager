/** Private ordinary Node entry. Secrets travel through stdin/stdout pipes, never argv or logs. */
import { connectionSetup, type ConnectionSetupReply } from './connection-setup';

void (async () => {
  let reply: ConnectionSetupReply;
  try {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 16 * 1024) throw new Error('The desktop setup request is too large.');
      chunks.push(bytes);
    }
    let request: unknown;
    try { request = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Invalid desktop setup request.'); }
    reply = { ok: true, result: await connectionSetup(request, { development: process.env.RI_DESKTOP_SETUP_DEVELOPMENT === '1' }) };
  } catch (error) {
    reply = { ok: false, error: error instanceof SyntaxError ? 'A saved setup record could not be read. Review this installation before continuing.' : error instanceof Error ? error.message : 'Desktop setup failed. Try again.' };
  }
  process.stdout.write(JSON.stringify(reply));
})();
