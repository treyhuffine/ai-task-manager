import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ personal: false }));
vi.mock('@/components/home/home-context', () => ({ useOptionalHomeContext: () => ({ capabilities: { privatePlanning: state.personal }, home: { name: 'Team Huffine' }, executionChoices: [] }) }));
import { LaunchAudience } from './launch-audience';
it('shows the shared audience and the selected execution destination before launch', () => {
  state.personal = false;
  const html = renderToStaticMarkup(createElement(LaunchAudience));
  expect(html).toContain('Shared with Team Huffine.'); expect(html).toContain('server.');
});
it('does not add member vocabulary to the ordinary personal launcher', () => {
  state.personal = true; expect(renderToStaticMarkup(createElement(LaunchAudience))).toBe('');
});
