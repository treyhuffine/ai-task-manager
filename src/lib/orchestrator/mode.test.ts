import { describe, expect, it } from 'vitest';
import { resolveOrchestratorMode } from './mode';

describe('resolveOrchestratorMode', () => {
  it('runs a home where nobody has chosen on the MCP surface', () => {
    expect(resolveOrchestratorMode(null)).toBe('harness_mcp');
    expect(resolveOrchestratorMode(undefined)).toBe('harness_mcp');
  });

  it('runs the retired built-in chat on the MCP surface', () => {
    expect(resolveOrchestratorMode('legacy')).toBe('harness_mcp');
  });

  it('keeps a harness mode the user chose', () => {
    expect(resolveOrchestratorMode('harness_skills')).toBe('harness_skills');
    expect(resolveOrchestratorMode('harness_mcp')).toBe('harness_mcp');
  });
});
