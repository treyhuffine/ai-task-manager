import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthoringDestination } from './use-authoring-destination';

const fixtures = vi.hoisted(() => ({ session: { id: 'author', status: 'active', surfaceKind: 'execution', externalSessionId: 'provider-chat',
  execution: { status: 'active', takeoverStartedAt: null as string | null } }, read: vi.fn() }));
vi.mock('@/hooks/use-execution', () => ({ useSession: (id: string | null) => {
  fixtures.read(id);
  return { data: id ? fixtures.session : undefined, isLoading: false };
} }));

function Probe({ enabled = true }: { enabled?: boolean }) {
  const result = useAuthoringDestination('author', enabled);
  return createElement('div', { 'data-available': result.available }, result.reason ?? 'Ready for feedback');
}

beforeEach(() => {
  fixtures.read.mockClear();
  Object.assign(fixtures.session, { status: 'active', surfaceKind: 'execution', externalSessionId: 'provider-chat', execution: { status: 'active', takeoverStartedAt: null } });
});

describe('authoring conversation availability', () => {
  it('reads takeover state from the producing execution and keeps the saved output available', () => {
    fixtures.session.execution.takeoverStartedAt = '2026-10-08';
    const html = renderToStaticMarkup(createElement(Probe));
    expect(html).toContain('data-available="false"');
    expect(html).toContain('read-only. Existing output can still be saved.');
  });

  it('allows a resumed imported chat but refuses an untouched external mirror', () => {
    fixtures.session.surfaceKind = 'imported_agent';
    expect(renderToStaticMarkup(createElement(Probe))).toContain('data-available="true"');
    fixtures.session.externalSessionId = '';
    expect(renderToStaticMarkup(createElement(Probe))).toContain('data-available="false"');
  });

  it('does not fetch authoring scope when the operation is disabled', () => {
    renderToStaticMarkup(createElement(Probe, { enabled: false }));
    expect(fixtures.read).toHaveBeenCalledExactlyOnceWith(null);
  });
});
