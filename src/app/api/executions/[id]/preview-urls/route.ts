/**
 * Manual preview URLs on an execution (BYO tunnel — §6). The user runs
 * their own tunnel (ngrok/cloudflared/whatever) and pastes the URL; the
 * ManualProvider serves it. `PUT` replaces the whole list (set-or-clear);
 * send `[]` to clear.
 */

import type { NextRequest } from 'next/server';
import { z } from 'zod';
import { setPreviewUrls } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';

export const runtime = 'nodejs';

const previewUrlSchema = z.object({
  service: z.string().trim().min(1).nullable().optional(),
  url: z.string().trim().url('Must be a valid http(s) URL'),
  label: z.string().trim().min(1).nullable().optional(),
});

const bodySchema = z.object({
  urls: z.array(previewUrlSchema).max(20),
});

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return Response.json(
        { error: 'invalid_params', message: parsed.error.issues[0]?.message ?? 'Invalid preview URLs.' },
        { status: 400 },
      );
    }
    const urls = parsed.data.urls.map((u) => ({
      service: u.service ?? null,
      url: u.url,
      label: u.label ?? null,
    }));
    return Response.json({ urls: setPreviewUrls(id, urls) });
  } catch (err) {
    return previewErrorResponse(err, 'PUT /api/executions/:id/preview-urls');
  }
}
