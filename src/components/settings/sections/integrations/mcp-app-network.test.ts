import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppNetworkList, type AppNetwork } from './mcp-app-network';

const none: AppNetwork = { screens: 2, read: 2, connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] };
const shown = (network: AppNetwork) => renderToStaticMarkup(createElement(AppNetworkList, { network, name: 'Excalidraw' }));

describe('what a server\'s screens may reach, on its connection page', () => {
  it('says plainly when its screens declared no sites', () => {
    expect(shown(none)).toContain('Excalidraw&#x27;s screens declare no sites, so they can&#x27;t reach the network.');
  });

  it('lists each declared site by what a screen may do with it, and only those kinds', () => {
    const html = shown({ ...none, connectDomains: ['https://esm.sh'], resourceDomains: ['https://esm.sh'] });
    expect(html).toContain('may reach these sites, which they declared. They can reach nothing else.');
    expect(html).toContain('Exchange data with');
    expect(html).toContain('Load code, styles, images and fonts from');
    expect(html).not.toContain('Show pages from');
    expect(html.match(/https:\/\/esm\.sh/g)).toHaveLength(2);
  });

  it('says when a screen couldn\'t be read, so the list may be incomplete', () => {
    expect(shown({ ...none, read: 1 })).toContain('couldn&#x27;t read one of its screens just now');
  });
});
