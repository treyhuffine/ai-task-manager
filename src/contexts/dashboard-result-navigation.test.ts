import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const navigation = vi.hoisted(() => ({ query: '' }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(navigation.query), usePathname: () => '/' }));
vi.mock('@/lib/client/quick-capture', () => ({ useQuickCaptureOpen: () => false, setQuickCaptureOpen: vi.fn(), toggleQuickCapture: vi.fn() }));
vi.mock('@/lib/_debug/hot-path', () => ({ hot: vi.fn() }));
import { DashboardProvider, useDashboard } from './dashboard-context';

function Destination() {
  const { activeView, activeSessionId, mobileTab } = useDashboard();
  return createElement('output', null, JSON.stringify({ activeView, activeSessionId, mobileTab }));
}

describe('saved result return navigation', () => {
  it('opens the exact source conversation on mobile on the first render', () => {
    navigation.query = 'session=content-source';
    const html = renderToStaticMarkup(createElement(DashboardProvider, null, createElement(Destination)));
    expect(html).toContain('&quot;activeSessionId&quot;:&quot;content-source&quot;');
    expect(html).toContain('&quot;mobileTab&quot;:&quot;agents&quot;');
  });
  it('opens a linked agent setup deep link on its mobile tools surface', () => {
    navigation.query = 'agent=author-agent&tab=setup';
    const html = renderToStaticMarkup(createElement(DashboardProvider, null, createElement(Destination)));
    expect(html).toContain('&quot;tab&quot;:&quot;setup&quot;');
    expect(html).toContain('&quot;mobileTab&quot;:&quot;agents&quot;');
  });
  it('keeps the normal Ri chat as the default home surface', () => {
    navigation.query = '';
    const html = renderToStaticMarkup(createElement(DashboardProvider, null, createElement(Destination)));
    expect(html).toContain('&quot;mobileTab&quot;:&quot;chat&quot;');
    expect(html).toContain('&quot;activeSessionId&quot;:null');
  });
});
