/** An installed app's state with Restart and Logs (docs/personal-apps.md "Status, Restart and Logs"). */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: null as Record<string, unknown> | null }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: { queryKey?: unknown[] }) => ({ data: options.queryKey?.[0] === 'status' ? mocks.status : undefined }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { appBuilds: {
    status: { queryOptions: () => ({ queryKey: ['status'] }), queryKey: () => ['status'] },
    job: { queryOptions: () => ({ queryKey: ['job'] }) },
    logs: { queryOptions: () => ({ queryKey: ['logs'] }) },
    pathKey: () => ['appBuilds'],
  } },
  trpcClient: {},
}));

const render = async () => {
  const { AppStatusLine } = await import('./app-status');
  return renderToStaticMarkup(<AppStatusLine sourceId="s1" name="Tide Log" />);
};

it('says it\'s running, with its release, and offers Restart and Logs', async () => {
  mocks.status = { state: 'running', release: '3f2a9c1d0b7e', since: new Date(Date.now() - 2 * 3600_000).toISOString(), lastError: null, checkedAt: '' };
  const html = await render();
  expect(html).toContain('Running, release 3f2a9c1d0b7e, since 2 hr ago');
  expect(html).toContain('Restart');
  expect(html).toContain('Logs');
});

it('shows the last error when it stopped', async () => {
  mocks.status = { state: 'stopped', lastError: 'Error: listen EADDRINUSE 127.0.0.1:4310', checkedAt: '' };
  const html = await render();
  expect(html).toContain('Stopped');
  expect(html).toContain('EADDRINUSE');
});

it('offers nothing it can\'t do for an app on an older kit', async () => {
  mocks.status = { state: 'unknown', problem: 'kit_too_old', message: 'This app was made with an older app kit, which can’t report its state. Update its kit to see it here.', checkedAt: '' };
  const html = await render();
  expect(html).toContain('older app kit');
  expect(html).not.toContain('Restart');
  expect(html.replace(/<[^>]+>/g, '').replace(/&[#\w]+;/g, '')).not.toMatch(/—|;/);
});
