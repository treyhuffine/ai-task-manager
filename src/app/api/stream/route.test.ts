/**
 * The Stream inbox's own route: capture a thought, and list it. It had no
 * test of its own, so when a realtime route briefly took this path (P3
 * review fixes, 053bbc5) the suite stayed green while capture broke. This
 * keeps the path the inbox's.
 */

import { NextRequest } from 'next/server';
import { afterEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

// The route, not the triage it schedules after a capture (its own tests cover that).
const onStreamCaptured = vi.fn();
vi.mock('@/lib/stream-triage/triggers', () => ({ onStreamCaptured: (...args: unknown[]) => onStreamCaptured(...args) }));

let home: TestHome | undefined;
afterEach(async () => {
  await home?.cleanup();
  home = undefined;
});

it('captures into the stream and lists what was captured', async () => {
  home = await createTestHome({ prefix: 'ri-stream-route-' });
  const { GET, POST } = await import('./route');
  const created = await POST(
    new NextRequest('http://home/api/stream', { method: 'POST', body: JSON.stringify({ rawText: 'call the plumber' }), headers: { 'content-type': 'application/json' } }),
  );
  expect(created.status).toBe(201);
  const row = (await created.json()) as { id: string; rawText: string };
  expect(row.rawText).toBe('call the plumber');
  expect(onStreamCaptured).toHaveBeenCalledWith(row.id);
  const listed = await GET(new NextRequest('http://home/api/stream'));
  expect(listed.status).toBe(200);
  expect(listed.headers.get('content-type')).toContain('application/json');
  const rows = (await listed.json()) as Array<{ id: string }>;
  expect(rows.map((r) => r.id)).toContain(row.id);
});
