import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { McpServerDetail, mcpProtocolChip } from './mcp-server-detail';
import type { McpServerEntry } from './types';

const server: McpServerEntry = { id: 'bb', slug: 'bb', displayName: 'Bits & Bolts', url: 'http://localhost:3917/mcp', enabled: true, auth: { kind: 'none' }, lastStatus: 'ok', lastToolCount: 20 };
const render = (entry: McpServerEntry) => renderToStaticMarkup(createElement(McpServerDetail, {
  server: entry, busy: false, onBack: vi.fn(), onAuthorize: vi.fn(), onRetest: vi.fn(), onToggleEnabled: vi.fn(), onRemove: vi.fn(), onToolOverride: vi.fn(),
}));

describe('MCP protocol chip', () => {
  it('names the revision the last connection spoke', () => {
    expect(mcpProtocolChip({ version: '2026-07-28', era: 'modern', negotiation: 'probe', checkedAt: '2026-10-19T19:14:31.659Z' })).toEqual({ label: 'MCP 2026-07-28' });
    expect(render({ ...server, protocol: { version: '2026-07-28', era: 'modern', negotiation: 'probe', checkedAt: '2026-10-19T19:14:31.659Z' } })).toContain('MCP 2026-07-28');
  });

  it('explains only the older protocol', () => {
    expect(mcpProtocolChip({ version: '2025-11-25', era: 'legacy', negotiation: 'fallback', checkedAt: '2026-10-19T19:14:31.659Z' })).toEqual({
      label: 'MCP 2025-11-25', tip: expect.stringContaining('older MCP version'),
    });
  });

  it('shows nothing before a server has connected', () => {
    expect(mcpProtocolChip(undefined)).toBeNull();
    expect(mcpProtocolChip({ checkedAt: '2026-10-19T19:14:31.659Z' })).toBeNull();
    expect(render(server)).not.toContain('MCP 20');
  });
});
