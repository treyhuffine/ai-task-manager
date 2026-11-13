/** Ri's recommended apps on the Apps page (docs/personal-apps.md "The catalog"). */
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ catalog: { apps: [] as Record<string, unknown>[], error: null as string | null } }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.catalog }),
  useMutation: () => ({ mutate: () => {}, isPending: false }),
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));
vi.mock('@/lib/trpc/client', () => ({
  trpc: { appBuilds: { catalog: { queryOptions: () => ({ queryKey: ['catalog'] }) }, pathKey: () => ['appBuilds'] } },
  trpcClient: {},
}));
vi.mock('./new-app-dialog', () => ({ ensureAppBuilderChat: async () => ({ id: 'chat' }) }));

const app = (over: Record<string, unknown>) => ({
  id: 'tide-pools', name: 'Tide Pools', description: 'Tide pools you visited.', reaches: [], git: 'https://example.com/tide-pools.git',
  version: 'v1.1.0', checksum: `sha256-${'a'.repeat(64)}`, sourceId: null, personalAppId: null, installedVersion: null, updateAvailable: false, ...over,
});

it('offers each app with what it can reach, and Add, Update or Added by where it stands', async () => {
  mocks.catalog = {
    apps: [
      app({}),
      app({ id: 'travel', name: 'Travel', reaches: ['Your email, to find bookings'], sourceId: 's1', installedVersion: 'v1.0.0', updateAvailable: true }),
      app({ id: 'people', name: 'People', sourceId: 's2', installedVersion: 'v1.1.0' }),
    ],
    error: null,
  };
  const { AppCatalogList } = await import('./app-catalog');
  const html = renderToStaticMarkup(<AppCatalogList onOpen={() => {}} />);
  expect(html).toContain('Recommended apps');
  expect(html).toContain('Keeps to its own data.');
  expect(html).toContain('Can reach: Your email, to find bookings.');
  expect(html).toMatch(/>Add<\/button>/);
  expect(html).toMatch(/Update to (<!-- -->)?v1\.1\.0/);
  expect(html).toContain('Added');
  // The words a person reads, without markup or entities.
  expect(html.replace(/<[^>]+>/g, '').replace(/&[#\w]+;/g, '')).not.toMatch(/—|;/);
});

it('shows nothing when the catalog is empty, and says when it can\'t be read', async () => {
  const { AppCatalogList } = await import('./app-catalog');
  mocks.catalog = { apps: [], error: null };
  expect(renderToStaticMarkup(<AppCatalogList onOpen={() => {}} />)).toBe('');
  mocks.catalog = { apps: [], error: 'The app catalog isn’t valid: apps.0.git Use an https URL.' };
  expect(renderToStaticMarkup(<AppCatalogList onOpen={() => {}} />)).toContain('isn’t valid');
});
