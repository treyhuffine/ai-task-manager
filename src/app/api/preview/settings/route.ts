/**
 * Global preview settings — choose how previews are reached.
 *
 *   GET → { activeProvider, manualTemplate, providers[], beamd: {connected, server} }
 *   PUT { activeProvider?, manualTemplate?, connect?:{server,token,insecure}, disconnect? }
 *
 * beamd is NOT credential-managed by Flow. "Connect" drives `beamd login`,
 * which writes the machine's shared `~/.beamd/` account — the same one the
 * human at a terminal and the agent in a worktree use. Flow stores no token.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { readPreviewSettings, writePreviewSettings } from '@/lib/preview/settings';
import { beamdLogin, beamdLogout, beamdCheck, beamdConnectedServer, BeamdCliError } from '@/lib/preview/beamd/cli';
import { listPreviewProviders } from '@/lib/preview/service';

export const runtime = 'nodejs';

async function snapshot() {
  const settings = readPreviewSettings();
  const server = await beamdConnectedServer();
  return {
    activeProvider: settings.activeProvider,
    manualTemplate: settings.manualTemplate,
    beamd: { connected: server !== null, server },
    providers: listPreviewProviders(),
  };
}

export async function GET() {
  return Response.json(await snapshot());
}

const bodySchema = z.object({
  activeProvider: z.string().trim().min(1).optional(),
  manualTemplate: z.string().trim().nullable().optional(),
  connect: z
    .object({
      server: z.string().trim().min(1),
      token: z.string().trim().min(1),
      insecure: z.boolean().optional(),
    })
    .optional(),
  disconnect: z.boolean().optional(),
});

export async function PUT(request: NextRequest) {
  try {
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_params', message: parsed.error.issues[0]?.message ?? 'Invalid settings.' },
        { status: 400 },
      );
    }
    const body = parsed.data;

    if ('activeProvider' in body && body.activeProvider) {
      writePreviewSettings({ activeProvider: body.activeProvider });
    }
    if ('manualTemplate' in body) {
      writePreviewSettings({ manualTemplate: body.manualTemplate ?? null });
    }

    // Connect/disconnect drive beamd's own store (~/.beamd), not a Flow file.
    if (body.disconnect) {
      await beamdLogout();
    } else if (body.connect) {
      await beamdLogin({
        server: body.connect.server,
        token: body.connect.token,
        insecure: body.connect.insecure ?? false,
      });
      // `login` only *stores* the credential — it never proves it works. Verify
      // it against the edge so "connected" always means "verified", and roll the
      // bad login back so a rejected key doesn't linger and 401 every preview.
      try {
        await beamdCheck();
      } catch (err) {
        await beamdLogout().catch(() => {});
        throw err;
      }
    }

    return Response.json(await snapshot());
  } catch (err) {
    if (err instanceof BeamdCliError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[PUT /api/preview/settings]', err);
    return Response.json({ error: 'preview_settings_failed', message: String(err) }, { status: 500 });
  }
}
