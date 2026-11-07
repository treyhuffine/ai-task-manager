import { expect, it } from 'vitest';
import { isAgentCall, lastUseAt, noteUse } from './last-use';

it('remembers the last use', () => {
  noteUse(1234);
  expect(lastUseAt()).toBe(1234);
});

it('counts calls from connected agents, and nothing a window does by itself', () => {
  expect(isAgentCall('POST', '/api/mcp')).toBe(true);
  expect(isAgentCall('POST', '/api/orchestrator/mcp')).toBe(true);
  expect(isAgentCall('GET', '/api/mcp')).toBe(false);
  expect(isAgentCall('GET', '/api/live')).toBe(false);
  expect(isAgentCall('POST', '/api/desktop/notifications')).toBe(false);
});

it('counts an agent connected to a team as use', () => {
  expect(isAgentCall('POST', '/api/team/mcp')).toBe(true);
  expect(isAgentCall('GET', '/api/team/mcp')).toBe(false);
});

