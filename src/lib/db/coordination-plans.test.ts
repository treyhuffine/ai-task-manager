import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { getRawDb } from '@/lib/db';
import * as q from './coordination-queries';

let home: TestHome;
beforeEach(async () => { home = await createTestHome(); });
afterEach(async () => { vi.restoreAllMocks(); await home.cleanup(); });

it.each([
  ['due deliveries', () => q.dueAgentDeliveries(), 'idx_agent_coordination_deliveries_pending'],
  ['pending inputs', () => q.pendingAgentDeliveries('chat'), 'idx_agent_coordination_deliveries_target'],
  ['pending approvals', () => q.pendingAgentApprovals('chat'), 'idx_agent_coordination_deliveries_source'],
  ['outstanding work', () => q.hasOutstandingAgentRequests('chat'), 'idx_agent_coordination_requests_source'],
  ['assigned work', () => q.agentRequestForRun('run'), 'idx_agent_coordination_requests_run'],
  ['continued inputs', () => q.coordinationDeliveriesForRun('run'), 'idx_agent_coordination_deliveries_continuation'],
  ['input by event', () => q.agentDeliveryForEvent('event'), 'uniq_agent_coordination_deliveries_event'],
  ['pending device sends', () => q.hasPendingCoordinationSend('chat'), 'idx_worker_commands_chat'],
  ['incoming card states', () => q.incomingAgentDeliveryState('chat'), 'idx_agent_coordination_deliveries_target'],
] as const)('pins the actual query builder plan for %s', (_name, read, index) => {
  const raw = getRawDb();
  const prepare = vi.spyOn(raw, 'prepare');
  read();
  const queries = prepare.mock.calls.map(([query]) => query).filter(query => /from "(?:agent_coordination_|worker_commands)/.test(query));
  prepare.mockRestore();
  expect(queries.length).toBeGreaterThan(0);
  const plans = queries.flatMap(query => raw.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...Array(query.split('?').length - 1).fill('fixture')) as Array<{ detail: string }>);
  expect(plans.some(row => row.detail.includes(index))).toBe(true);
  expect(plans.some(row => /SCAN (chat_events|agent_coordination_)/.test(row.detail))).toBe(false);
});
