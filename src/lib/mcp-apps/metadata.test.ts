import { describe, expect, it } from 'vitest';
import { entrypointIcons, initialDisplayMode, mentionsSearchTool, resourceDisplayModes, settingsCapability, toolTitle, viewMetadata } from './metadata';
import { prepareResource } from './resource';

// The three entrypoints Bits & Bolts declares, as its server lists them.
const ui = (resourceUri: string, entrypoints: unknown[]) => ({ ui: { resourceUri }, 'openai/ui': { entrypoints } });
const browse = { name: 'cad.browse', title: 'Bits & Bolts', _meta: { ...ui('ui://bits-and-bolts/global-v35', [{ type: 'global', quickAction: { title: 'Choose a part' } }]), ui: { resourceUri: 'ui://bits-and-bolts/global-v35', visibility: ['app'] } } };
const tray = { name: 'cad.tray', title: 'Parts Tray', _meta: ui('ui://bits-and-bolts/thread-v35', [{ type: 'thread' }]) };
const open = { name: 'cad.open', title: 'Bits & Bolts CAD viewer', _meta: ui('ui://bits-and-bolts/file-v35', [{ type: 'file', extensions: ['.stl', '.3MF', '.step', '.stp', 'stl', '../x', ''] }]) };

describe('entrypoints', () => {
  it('reads global, thread and file entrypoints, with extensions in their accept form', () => {
    expect(viewMetadata(browse)).toMatchObject({ global: true, thread: false, file: [], app: true, model: false });
    expect(viewMetadata(tray)).toMatchObject({ global: false, thread: true, file: [] });
    expect(viewMetadata(open)).toMatchObject({ global: false, thread: false, file: ['.stl', '.3mf', '.step', '.stp'] });
  });

  it('gives a tool without an interface no entrypoints, whatever it declares', () => {
    expect(viewMetadata({ _meta: { 'openai/ui': { entrypoints: [{ type: 'global' }] } } })).toBeNull();
  });

  it('titles an entrypoint by title, then annotations.title, then name', () => {
    expect(toolTitle({ name: 'cad.tray', title: 'Parts Tray', annotations: { title: 'Tray' } })).toBe('Parts Tray');
    expect(toolTitle({ name: 'cad.tray', annotations: { title: 'Tray' } })).toBe('Tray');
    expect(toolTitle({ name: 'cad.tray', title: '  ' })).toBe('cad.tray');
  });

  it('uses the tool icon, then the server icon, then none', () => {
    const tool = { src: 'data:image/svg+xml,%3Csvg%2F%3E', theme: 'dark' as const };
    const server = { src: 'https://example.com/server.png' };
    expect(entrypointIcons({ icons: [tool] }, [server])).toEqual([tool]);
    expect(entrypointIcons({ icons: [{ src: 'javascript:alert(1)' }] }, [server])).toEqual([server]);
    expect(entrypointIcons({}, undefined)).toEqual([]);
  });
});

describe('display modes', () => {
  it('reads the modes a UI resource declares, without picture-in-picture', () => {
    expect(resourceDisplayModes({ 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen', 'pip'], preferredDisplayMode: 'inline' } }))
      .toEqual({ available: ['inline', 'fullscreen'], preferred: 'inline' });
    expect(resourceDisplayModes({ 'openai/ui': { availableDisplayModes: ['fullscreen'], preferredDisplayMode: 'inline' } })).toEqual({ available: ['fullscreen'] });
    expect(resourceDisplayModes(undefined)).toEqual({ available: ['inline', 'fullscreen'] });
  });

  it('opens as ChatGPT does: preferred first, both declared means full screen, nothing declared means inline', () => {
    expect(initialDisplayMode({ available: ['inline', 'fullscreen'], preferred: 'inline' }, true)).toBe('inline');
    expect(initialDisplayMode({ available: ['inline', 'fullscreen'] }, true)).toBe('fullscreen');
    expect(initialDisplayMode({ available: ['inline', 'fullscreen'] }, false)).toBe('inline');
    expect(initialDisplayMode({ available: ['inline'] }, true)).toBe('inline');
  });

  it('comes back from the UI resource with the prepared view', () => {
    const uri = 'ui://bits-and-bolts/widget-v35';
    const prepared = prepareResource({ contents: [{ uri, mimeType: 'text/html;profile=mcp-app', text: '<p>Part</p>', _meta: { 'openai/ui': { availableDisplayModes: ['inline', 'fullscreen'], preferredDisplayMode: 'inline' } } }] }, uri, false);
    expect(prepared.displayModes).toEqual({ available: ['inline', 'fullscreen'], preferred: 'inline', declared: true });
  });
});

describe('server capabilities', () => {
  it('reads openai/settings and openai/mentions, and the deprecated per-tool mention marker', () => {
    const extensions = { 'openai/settings': { readTool: 'settings.read', updateTool: 'settings.update' }, 'openai/mentions': { searchTool: 'search_mentions' } };
    expect(settingsCapability(extensions)).toEqual({ readTool: 'settings.read', updateTool: 'settings.update' });
    expect(settingsCapability({ 'openai/settings': { readTool: 'settings.read' } })).toBeNull();
    expect(mentionsSearchTool(extensions, [])).toBe('search_mentions');
    expect(mentionsSearchTool({}, [{ name: 'old_search', _meta: { 'openai/extensions': { 'mentions/search': {} } } }])).toBe('old_search');
    expect(mentionsSearchTool({}, [{ name: 'plain' }])).toBeNull();
  });
});
