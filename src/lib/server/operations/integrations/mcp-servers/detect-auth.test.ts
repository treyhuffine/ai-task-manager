import { describe, expect, it, vi } from 'vitest';
import type { McpAuthDetection } from '@/lib/integrations/mcp-auth-detect';
import { POST, POSTInput } from './detect-auth';

const probe = vi.hoisted(() => ({ detectMcpAuth: vi.fn<(url: string, options?: { signal?: AbortSignal }) => Promise<McpAuthDetection>>() }));
vi.mock('@/lib/integrations/mcp-auth-detect', () => ({ detectMcpAuth: probe.detectMcpAuth }));

const context = (signal: AbortSignal) => ({ headers: new Headers(), url: 'https://ri.example/api/trpc', nextUrl: new URL('https://ri.example/api/trpc'), signal });

describe('mcp-servers detect-auth operation', () => {
  it('returns the probe verdict for the typed address, under the request cancellation', async () => {
    const detection: McpAuthDetection = { method: 'oauth', registration: 'dynamic', authorizationServer: 'https://auth.example/', pkce: true };
    probe.detectMcpAuth.mockResolvedValueOnce(detection);
    const controller = new AbortController();
    const result = await POST(POSTInput.parse({ body: { url: 'https://mcp.example/mcp' } }), context(controller.signal));
    expect(result).toEqual({ ok: true, status: 200, data: { detection }, headers: undefined });
    expect(probe.detectMcpAuth).toHaveBeenCalledExactlyOnceWith('https://mcp.example/mcp', { signal: controller.signal });
  });

  it('passes an unusable address through as a verdict rather than a failure', async () => {
    probe.detectMcpAuth.mockResolvedValueOnce({ method: 'unknown', reason: 'invalid_url', message: 'Use an https:// URL (http:// is allowed only for localhost).' });
    const result = await POST({ body: { url: 'http://example.com/mcp' } }, context(new AbortController().signal));
    expect(result.ok).toBe(true);
    expect(result.ok && result.data.detection).toMatchObject({ method: 'unknown', reason: 'invalid_url' });
  });

  it('validates the input shape before probing anything', () => {
    expect(POSTInput.safeParse({ body: { url: 'x'.repeat(2049) } }).success).toBe(false);
    expect(POSTInput.safeParse({ body: { url: 'https://mcp.example', auth: { kind: 'none' } } }).success).toBe(false);
    expect(POSTInput.safeParse({ body: {} }).success).toBe(false);
  });
});
