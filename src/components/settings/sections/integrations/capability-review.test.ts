import { Children, createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CapabilityReview } from './capability-review';
import { McpServerDetail } from './mcp-server-detail';
import type { McpCapabilityChanges } from '@/lib/integrations/mcp-capabilities';

const changes: McpCapabilityChanges = {
  revision: 'current-inventory', added: ['add-task'], removed: ['legacy-task'],
  changed: [{ name: 'edit-task', fields: ['inputSchema', 'outputSchema', 'annotations'] }],
};

describe('capability review', () => {
  it('acknowledges the displayed revision and never mutates permissions', () => {
    const onReview = vi.fn();
    const element = CapabilityReview({ changes, busy: false, onReview })!;
    const button = Children.toArray(element.props.children).find(child => isValidElement(child) && typeof (child.props as { onClick?: unknown }).onClick === 'function') as ReactElement<{ onClick: () => void }>;
    button.props.onClick();
    expect(onReview).toHaveBeenCalledExactlyOnceWith('current-inventory');
    const html = renderToStaticMarkup(element);
    expect(html).toContain('inputs, outputs, permissions and behavior');
    expect(html).toContain('does not change permissions');
  });

  it('shows no alert for the first baseline or an unchanged inventory', () => {
    expect(CapabilityReview({ busy: false, onReview: vi.fn() })).toBeNull();
  });

  it('exposes the same review on a custom server without hiding per-tool controls', () => {
    const html = renderToStaticMarkup(createElement(McpServerDetail, {
      server: { id: 'custom', slug: 'custom', displayName: 'Custom', url: 'https://example.com/mcp', enabled: true, auth: { kind: 'none' }, capabilityChanges: changes, tools: [{ name: 'add-task' }] },
      busy: true, onBack: vi.fn(), onAuthorize: vi.fn(), onRetest: vi.fn(), onToggleEnabled: vi.fn(), onRemove: vi.fn(), onToolOverride: vi.fn(), onReviewCapabilities: vi.fn(),
    }));
    expect(html).toContain('Tools changed since your last review');
    expect(html).toContain('Ask first');
    expect(html).toMatch(/<button(?=[^>]*disabled="")[^>]*>Mark reviewed<\/button>/);
  });
});
