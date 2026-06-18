/**
 * Device-code (browser-approve) connect — the hosted on-ramp.
 *
 * Streams NDJSON so the client can show the approval code the moment beamd
 * issues it, then react to the terminal outcome:
 *
 *   { phase: 'pending', pending: { verificationUriComplete, userCode, … } }
 *   { phase: 'connected', server, slug }                 // verified + persisted
 *   { phase: 'unsupported', code, message }              // → fall back to token paste
 *   { phase: 'error', code, message }
 *
 * Like the token path, "connected" means *verified*: we run `beamd check` after
 * the login exits 0 (and use its server/slug), rolling the login back on
 * failure. beamd owns the credential in `~/.beamd/`; Flow stores nothing.
 * `beamdLoginDevice` drives the real interactive `beamd login` (no `--token`)
 * and scrapes its URL + code; an edge that can't do browser approval surfaces
 * `unsupported`, so the UI degrades to the API-key form with no breakage.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { beamdLoginDevice, beamdCheck, beamdLogout, BeamdCliError } from '@/lib/preview/beamd/cli';

export const runtime = 'nodejs';

const bodySchema = z.object({
  server: z.string().trim().optional(),
  insecure: z.boolean().optional(),
});

export async function POST(request: NextRequest) {
  const body = bodySchema.safeParse(await request.json().catch(() => ({})));
  const { server, insecure } = body.success ? body.data : {};

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (obj: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(JSON.stringify(obj) + '\n'));
      };

      try {
        await beamdLoginDevice(
          { server, insecure, signal: request.signal },
          (pending) => send({ phase: 'pending', pending }),
        );

        // Verified-on-connect parity with the token path: prove the new
        // credential works against the edge (and get the authoritative
        // server/slug), rolling it back if it doesn't so a half-written login
        // can't linger and 401 every preview.
        let checked;
        try {
          checked = await beamdCheck();
        } catch (err) {
          await beamdLogout().catch(() => {});
          throw err;
        }

        send({ phase: 'connected', server: checked.server, slug: checked.slug });
      } catch (err) {
        if (err instanceof BeamdCliError) {
          send({
            phase: err.code === 'beamd_device_unsupported' ? 'unsupported' : 'error',
            code: err.code,
            message: err.message,
          });
        } else {
          send({ phase: 'error', code: 'beamd_error', message: String(err) });
        }
      } finally {
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    },
  });
}
