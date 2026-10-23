import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { HomeBoundary, useHomeContext } from '@/components/home/home-context';
import type { HomeContext } from '@/lib/home/context';
import { teamCapabilities } from '@/lib/team/capabilities';
import { QueryProvider } from './query-provider';

function Identity() { return createElement('p', null, useHomeContext().home.name); }
const identity = (name: string): HomeContext => ({ home: { id: name, name, kind: 'personal' }, viewer: { id: 'local', name, role: 'personal' }, executionChoices: [], capabilities: { ...teamCapabilities({ role: 'owner', status: 'active' }), privatePlanning: true } });
const render = (initialHomeContext?: HomeContext) => renderToStaticMarkup(<QueryProvider initialHomeContext={initialHomeContext}><HomeBoundary><Identity /></HomeBoundary></QueryProvider>);

it('renders authenticated content on the server without an identity query or loading gate', () => {
  expect(render(identity('Personal Home'))).toBe('<p>Personal Home</p>');
});
it('keeps server request caches separate and never bootstraps an unauthenticated request from another Home', () => {
  expect(render(identity('First Home'))).toContain('First Home');
  expect(render(identity('Second Home'))).toBe('<p>Second Home</p>');
  const unsigned = render();
  expect(unsigned).toContain('aria-label="Loading Home"');
  expect(unsigned).not.toContain('First Home'); expect(unsigned).not.toContain('Second Home');
});
