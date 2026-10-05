import { describe, expect, it } from 'vitest';
import { procedureLabel, requestLabel } from './labels';

describe('requestLabel', () => {
  it('names a tRPC request by its procedure, the same label the middleware uses', () => {
    expect(requestLabel('GET', '/api/trpc/claudeAuth.stuckSessionsGet')).toBe(procedureLabel('claudeAuth.stuckSessionsGet'));
    expect(requestLabel('GET', '/api/trpc/tasks.list%2Cnotes.list')).toBe('trpc:tasks.list,notes.list');
  });

  it('folds record ids so each route is one label', () => {
    expect(requestLabel('GET', '/api/sessions/019f6b9f-10c3-7cd4-8dbd-520631d2c0f7/events')).toBe('http:GET /api/sessions/:id/events');
    expect(requestLabel('GET', '/api/attachments/01a10dbe-ce35-7103-a388-186a95e70d88.png')).toBe('http:GET /api/attachments/:id');
    expect(requestLabel('POST', '/api/workers/me/commands/42/ack')).toBe('http:POST /api/workers/me/commands/:id/ack');
  });

  it('keeps named segments, like orchestrator actions, and collapses Next assets', () => {
    expect(requestLabel('POST', '/api/orchestrator/actions/update_task')).toBe('http:POST /api/orchestrator/actions/update_task');
    expect(requestLabel('GET', '/api/live')).toBe('http:GET /api/live');
    expect(requestLabel('GET', '/_next/static/chunks/app-4f2a91c0d3.js')).toBe('http:GET /_next/*');
    expect(requestLabel('GET', '/')).toBe('http:GET /');
    expect(requestLabel(undefined, '/api/health')).toBe('http:GET /api/health');
  });
});
