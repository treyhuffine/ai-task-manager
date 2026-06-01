/**
 * Global preview settings — choose how previews are reached.
 *
 *   GET → { activeProvider, manualTemplate, beamdBinPath, beamd: {server, configured}, providers[] }
 *   PUT { activeProvider?, manualTemplate?, beamdBinPath?, beamdServer?, beamdToken? }
 *
 * The beamd `{server, token}` is written to `beamd.yaml` (the CLI's --config
 * file); the token is never read back to the client. Everything else lives
 * in `preview.json`.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import {
  readPreviewSettings,
  writePreviewSettings,
} from '@/lib/preview/settings';
import {
  readBeamdServer,
  readBeamdInsecure,
  writeBeamdConfig,
  clearBeamdConfig,
  beamdConfigExists,
} from '@/lib/preview/beamd/config';
import { setBeamdBinOverride, beamdReload } from '@/lib/preview/beamd/cli';
import { listPreviewProviders } from '@/lib/preview/service';

export const runtime = 'nodejs';

function snapshot() {
  const settings = readPreviewSettings();
  return {
    activeProvider: settings.activeProvider,
    manualTemplate: settings.manualTemplate,
    beamdBinPath: settings.beamdBinPath,
    beamd: {
      server: readBeamdServer(),
      configured: beamdConfigExists(),
      insecure: readBeamdInsecure(),
    },
    providers: listPreviewProviders(),
  };
}

export function GET() {
  return Response.json(snapshot());
}

const bodySchema = z.object({
  activeProvider: z.string().trim().min(1).optional(),
  manualTemplate: z.string().trim().nullable().optional(),
  beamdBinPath: z.string().trim().nullable().optional(),
  beamdServer: z.string().trim().nullable().optional(),
  beamdToken: z.string().trim().nullable().optional(),
  /** Skip edge TLS verification — self-hosted self-signed edges only. */
  beamdInsecure: z.boolean().optional(),
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

    // Persist provider/template/bin settings.
    const patch: Parameters<typeof writePreviewSettings>[0] = {};
    if ('activeProvider' in body && body.activeProvider) patch.activeProvider = body.activeProvider;
    if ('manualTemplate' in body) patch.manualTemplate = body.manualTemplate ?? null;
    if ('beamdBinPath' in body) patch.beamdBinPath = body.beamdBinPath ?? null;
    const saved = writePreviewSettings(patch);
    setBeamdBinOverride(saved.beamdBinPath);

    // beamd creds: write the YAML only when a server is provided. A blank
    // server clears the config; a server without a token is rejected (we
    // can't read the existing token back to merge).
    if ('beamdServer' in body) {
      const server = body.beamdServer?.trim() ?? '';
      if (!server) {
        clearBeamdConfig();
      } else {
        const token = body.beamdToken?.trim() ?? '';
        if (!token) {
          return Response.json(
            { error: 'invalid_params', message: 'A beamd token is required when setting the server.' },
            { status: 400 },
          );
        }
        writeBeamdConfig({ server, token, insecureSkipVerify: body.beamdInsecure ?? false });
        // A long-lived agent caches creds for its lifetime, so respawn it to
        // pick up the new server/token (beamd 0.0.2+). Best-effort — drops
        // any live tunnels, which will re-resolve on next view.
        setBeamdBinOverride(saved.beamdBinPath);
        await beamdReload().catch(() => {});
      }
    }

    return Response.json(snapshot());
  } catch (err) {
    console.error('[PUT /api/preview/settings]', err);
    return Response.json({ error: 'preview_settings_failed', message: String(err) }, { status: 500 });
  }
}
