import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { useOpener } from './use-opener';
const scope = vi.hoisted(() => ({ personalServices: false }));
vi.mock('@/components/home/home-context', () => ({ useOptionalHomeContext: () => ({ capabilities: scope }) }));
vi.mock('@/hooks/use-client-location', () => ({ useClientLocation: () => ({ kind: 'host' }) }));
vi.mock('@/hooks/use-devices', () => ({ useThisDevice: () => null }));
vi.mock('@/hooks/use-execution', () => ({ useSession: () => ({ data: null }) }));
vi.mock('@/hooks/use-workspaces', () => ({ useRunOn: () => ({ data: null }) }));
function Controls() { const { opener, filesOn } = useOpener(null, '/server/project'); return <p>{opener ? 'Open in editor' : `Copy path on ${filesOn}`}</p>; }
afterEach(() => { scope.personalServices = false; });
it('a localhost Team viewer gets copy-path controls without a desktop opener', () => {
  expect(renderToStaticMarkup(<Controls />)).toContain('Copy path on the team server');
  scope.personalServices = true;
  expect(renderToStaticMarkup(<Controls />)).toContain('Open in editor');
});
