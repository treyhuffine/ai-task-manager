import { describe, expect, it } from 'vitest';
import { agentSkillState, type AgentSkillStatus } from './agent-skill-state';

// The real type ties the desktop shape to literal values, so a patched mix is cast.
const status = (patch: Partial<Record<keyof AgentSkillStatus, unknown>>) =>
  ({ appOnly: false, enabled: true, configured: true, installed: true, conflicts: [], folders: [], ...patch }) as AgentSkillStatus;

describe('agentSkillState', () => {
  it('reads what is on disk before the saved choice', () => {
    expect(agentSkillState(status({}))).toBe('on');
    // Installed by another path while the saved choice was never made.
    expect(agentSkillState(status({ configured: false, enabled: false }))).toBe('on');
    // Still chosen, but a link was deleted by hand: offer to install again.
    expect(agentSkillState(status({ installed: false }))).toBe('off');
  });

  it('keeps an uninstall on purpose apart from never chosen', () => {
    expect(agentSkillState(status({ installed: false, enabled: false }))).toBe('declined');
    expect(agentSkillState(status({ installed: false, enabled: false, configured: false }))).toBe('off');
    // A name taken by something else doesn't matter once they said no.
    expect(agentSkillState(status({ installed: false, enabled: false, conflicts: ['~/.claude/skills/x'] }))).toBe('declined');
  });

  it('says when another skill holds the name', () => {
    expect(agentSkillState(status({ installed: false, conflicts: ['~/.claude/skills/x'] }))).toBe('blocked');
    expect(agentSkillState(status({ installed: false, configured: false, enabled: false, conflicts: ['~/.claude/skills/x'] }))).toBe('blocked');
  });

  it('has nothing to offer in the desktop app', () => {
    expect(agentSkillState(status({ appOnly: true, installed: false, enabled: false }))).toBe('app-only');
  });
});
