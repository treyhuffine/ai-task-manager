'use client';

import { useEffect, useState } from 'react';
import type { McpAuthDetectionState } from '@/components/settings/sections/integrations/mcp-auth-detection';
import { errMsg } from '@/components/settings/sections/integrations/types';
import type { McpAuthDetection } from '@/lib/integrations/mcp-auth-detect';
import { validateMcpUrl } from '@/lib/integrations/mcp-validate';
import { trpcClient } from '@/lib/trpc/client';

export const MCP_AUTH_DETECTION_DEBOUNCE_MS = 600;

export type McpAuthProbe = (url: string) => Promise<McpAuthDetection>;

const probeThroughHome: McpAuthProbe = async url =>
  (await trpcClient.integrations.mcpServersDetectAuth.mutate({ body: { url } })).detection;

/**
 * Probe how the MCP server at `url` authenticates, a moment after typing stops.
 * An address that fails Ri's own URL rule gets its verdict without a request.
 * A half-typed address stays quiet. The answer belongs to the address it was
 * asked for, so a late reply for an older address never shows.
 */
export function useMcpAuthDetection(url: string, enabled = true, probe: McpAuthProbe = probeThroughHome): McpAuthDetectionState {
  const trimmed = url.trim();
  const check = validateMcpUrl(trimmed);
  const target = enabled && check.ok ? trimmed : null;
  const [result, setResult] = useState<{ url: string; detection: McpAuthDetection } | null>(null);

  useEffect(() => {
    if (!target) return;
    let current = true;
    const timer = setTimeout(async () => {
      let detection: McpAuthDetection;
      try { detection = await probe(target); }
      catch (error) { detection = { method: 'unknown', reason: 'unreachable', message: errMsg(error) }; }
      if (current) setResult({ url: target, detection });
    }, MCP_AUTH_DETECTION_DEBOUNCE_MS);
    return () => { current = false; clearTimeout(timer); };
  }, [target, probe]);

  if (!enabled || !trimmed) return { status: 'idle' };
  if (!check.ok) {
    const complete = /^[a-z][a-z0-9+.-]*:\/\/[^/\s]+/i.test(trimmed);
    return complete ? { status: 'done', url: trimmed, detection: { method: 'unknown', reason: 'invalid_url', message: check.error } } : { status: 'idle' };
  }
  if (result?.url === trimmed) return { status: 'done', url: trimmed, detection: result.detection };
  // A valid address without its verdict yet is being checked, or about to be.
  return { status: 'checking', url: trimmed };
}
