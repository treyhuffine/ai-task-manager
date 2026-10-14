import { describe, expect, it } from 'vitest';
import { PLUGIN_CREATE_ANCHORS, pluginsTabFor } from './navigation';

describe('Plugins destinations', () => {
  it.each([null, 'integrations', 'integrations:github', PLUGIN_CREATE_ANCHORS.connectService])('opens service browsing for %s', anchor => {
    expect(pluginsTabFor(anchor)).toBe('integrations');
  });
  it('opens skill management', () => expect(pluginsTabFor('skills')).toBe('skills'));
  it.each(['mcp', PLUGIN_CREATE_ANCHORS.mcpServer, 'mcp:my-server'])('opens custom tools for %s', anchor => {
    expect(pluginsTabFor(anchor)).toBe('mcp');
  });
  it('keeps old or unknown links usable', () => expect(pluginsTabFor('old-link')).toBe('integrations'));
});
