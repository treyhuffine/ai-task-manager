import { describe, expect, it } from 'vitest';
import { clearMcpToolApprovals, DEFAULT_MCP_APPROVAL_POLICY, mcpIngestOverrides, patchMcpToolOverrides, resolveMcpToolApproval } from './mcp-approval-policy';

describe('MCP permission precedence', () => {
  it('allows annotated reads and asks for writes and unmarked tools by default', () => {
    expect(DEFAULT_MCP_APPROVAL_POLICY).toBe('writes');
    expect(resolveMcpToolApproval({}, 'read', DEFAULT_MCP_APPROVAL_POLICY, false)).toBe('auto');
    expect(resolveMcpToolApproval({}, 'write', DEFAULT_MCP_APPROVAL_POLICY, true)).toBe('ask');
  });

  it('resolves explicit tool choice, server choice, then global preference', () => {
    const server = { approvalPolicy: 'auto' as const, toolOverrides: { read: { approvalMode: 'ask' as const } } };
    expect(resolveMcpToolApproval(server, 'read', 'writes', false)).toBe('ask');
    expect(resolveMcpToolApproval(server, 'write', 'ask', true)).toBe('auto');
    expect(resolveMcpToolApproval({}, 'read', 'ask', false)).toBe('ask');
    expect(resolveMcpToolApproval({}, 'write', 'auto', true)).toBe('auto');
  });

  it('preserves both legacy Ask first choices independently of tool facts', () => {
    const server = { toolOverrides: { write: { mutating: false }, read: { mutating: true } } };
    expect(resolveMcpToolApproval(server, 'write', 'writes', true)).toBe('auto');
    expect(resolveMcpToolApproval(server, 'read', 'writes', false)).toBe('ask');
    expect(mcpIngestOverrides(server.toolOverrides)).toEqual({});
  });

  it('clears permission exceptions while preserving disabled and explicitly enabled tools', () => {
    const overrides = { hidden: { enabled: false, mutating: false }, enabled: { enabled: true, approvalMode: 'ask' as const }, read: { approvalMode: 'ask' as const } };
    expect(clearMcpToolApprovals(overrides)).toEqual({ hidden: { enabled: false }, enabled: { enabled: true } });
    expect(overrides.hidden.mutating).toBe(false);
  });

  it('patches one tool without replacing other choices and can return to inheritance', () => {
    const original = { hidden: { enabled: false }, legacy: { enabled: true, mutating: false } };
    const next = patchMcpToolOverrides(original, { legacy: { approvalMode: 'ask' }, new: { approvalMode: 'auto' } });
    expect(next).toEqual({ hidden: { enabled: false }, legacy: { enabled: true, approvalMode: 'ask' }, new: { approvalMode: 'auto' } });
    expect(patchMcpToolOverrides(next, { legacy: { approvalMode: null }, new: { approvalMode: null } }))
      .toEqual({ hidden: { enabled: false }, legacy: { enabled: true } });
    expect(patchMcpToolOverrides(original, { legacy: { approvalMode: null } })).toEqual({ hidden: { enabled: false }, legacy: { enabled: true } });
  });
  it('treats arbitrary remote tool names as plain dictionary keys', () => {
    const next = patchMcpToolOverrides(undefined, JSON.parse('{"__proto__":{"approvalMode":"auto"},"constructor":{"enabled":false}}'));
    expect(Object.hasOwn(next, '__proto__')).toBe(true);
    expect(resolveMcpToolApproval({ toolOverrides: next }, '__proto__', 'ask', true)).toBe('auto');
    expect(JSON.parse(JSON.stringify(next))).toEqual({ ['__proto__']: { approvalMode: 'auto' }, constructor: { enabled: false } });
  });
});
