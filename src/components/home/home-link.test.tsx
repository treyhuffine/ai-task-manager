import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SpaceContext } from '@/components/spaces/space-root';
import { HomeLink } from './home-link';

it('keeps exact results and their authoring chat in the connected Home document', () => {
  const html = renderToStaticMarkup(<SpaceContext.Provider value={{ id: 'connected-team', name: 'Team', status: 'active' }}>
    <HomeLink href="/results/exact-id">Result</HomeLink><HomeLink href="/?session=chat-id">Author</HomeLink><HomeLink href="/">Home</HomeLink>
  </SpaceContext.Provider>);
  expect(html).toContain('href="/space/connected-team/results/exact-id"');
  expect(html).toContain('href="/space/connected-team?session=chat-id"');
  expect(html).toContain('href="/space/connected-team"');
  expect(renderToStaticMarkup(<HomeLink href="/results/exact-id">Result</HomeLink>)).toContain('href="/results/exact-id"');
});
