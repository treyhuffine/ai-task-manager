import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { McpDefaultPermissions, McpPermissionSelect } from './mcp-permissions';
import { McpServerDetail } from './mcp-server-detail';
import type { McpServerEntry } from './types';

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as ReactNode)] : []);
}
function serverDetail(patch: Partial<McpServerEntry> = {}, busy = false) {
  const onToolOverride = vi.fn(), onSetPolicy = vi.fn();
  const element = McpServerDetail({ server: { id: 'custom', slug: 'custom', displayName: 'Custom', url: 'https://example.com/mcp', enabled: true, auth: { kind: 'none' }, tools: [{ name: 'read', readOnlyHint: true }, { name: 'write' }], ...patch },
    busy, defaultPolicy: 'writes', onBack: vi.fn(), onAuthorize: vi.fn(), onRetest: vi.fn(), onToggleEnabled: vi.fn(), onRemove: vi.fn(), onToolOverride, onSetPolicy });
  return { element, onToolOverride, onSetPolicy };
}

describe('MCP permission controls', () => {
  it('offers inheritance and all three server-wide policies', () => {
    const onChange = vi.fn();
    const element = McpPermissionSelect({ value: null, inheritedLabel: 'Use global default', label: 'Permissions', busy: false, onChange });
    const choices = elements(element).filter(child => typeof child.props.value === 'string' && typeof child.props.children === 'string');
    expect(choices.map(child => child.props.children)).toEqual(['Use global default', 'Ask before writes', 'Always allow', 'Ask every time']);
    expect(renderToStaticMarkup(element)).toContain('Use global default');
    element.props.onValueChange('auto');
    element.props.onValueChange(element.props.value);
    expect(onChange.mock.calls).toEqual([['auto'], [null]]);
  });

  it('applies the global default to every server with one action', () => {
    const onApplyToAll = vi.fn();
    const element = McpDefaultPermissions({ override: null, busy: false, serverCount: 3, onChange: vi.fn(), onApplyToAll });
    const button = elements(element).find(child => child.props.children === 'Apply to all servers')!;
    (button.props.onClick as () => void)();
    expect(onApplyToAll).toHaveBeenCalledOnce();
    const html = renderToStaticMarkup(element);
    expect(html).toContain('Global MCP default');
    expect(html).toContain('Disabled tools stay off');
    expect(html).toContain('Saves immediately');
  });

  it('renders effective permissions and writes explicit permission choices', () => {
    const { element, onToolOverride } = serverDetail();
    const controls = elements(element);
    expect(renderToStaticMarkup(element)).toContain('Permissions for Custom');
    const read = controls.find(child => child.props['aria-label'] === 'Ask before read runs')!;
    const write = controls.find(child => child.props['aria-label'] === 'Ask before write runs')!;
    expect(read.props.checked).toBe(false);
    expect(write.props.checked).toBe(true);
    (write.props.onCheckedChange as (on: boolean) => void)(false);
    expect(onToolOverride).toHaveBeenCalledExactlyOnceWith('write', { approvalMode: 'auto' });
  });

  it('shows legacy choices, resets an individual exception, and offers a bulk server reset', () => {
    const { element, onToolOverride, onSetPolicy } = serverDetail({ approvalPolicy: 'auto', toolOverrides: { read: { mutating: true }, write: { approvalMode: 'ask' } } });
    const controls = elements(element);
    const reset = controls.find(child => child.props['aria-label'] === 'Use server permissions for read')!;
    (reset.props.onClick as () => void)();
    expect(onToolOverride).toHaveBeenCalledExactlyOnceWith('read', { approvalMode: null });
    const all = controls.find(child => child.props.children === 'Apply to all tools')!;
    (all.props.onClick as () => void)();
    expect(onSetPolicy).toHaveBeenCalledExactlyOnceWith('auto');
    expect(controls.find(child => child.props['aria-label'] === 'Ask before read runs')?.props.checked).toBe(true);
  });

  it('disables switches while saving and keeps disabled tools unavailable', () => {
    const { element } = serverDetail({ toolOverrides: { write: { enabled: false } } }, true);
    const controls = elements(element);
    for (const label of ['Enable read', 'Enable write', 'Ask before read runs', 'Ask before write runs'])
      expect(controls.find(child => child.props['aria-label'] === label)?.props.disabled).toBe(true);
    expect(controls.find(child => child.props['aria-label'] === 'Enable write')?.props.checked).toBe(false);
  });
});
