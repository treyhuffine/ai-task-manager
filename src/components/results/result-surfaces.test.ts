import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkResultRecord } from '@/db/types';
import type { WorkResultDetailResponse } from '@/lib/api/results';

const state = vi.hoisted(() => ({ enabled: false, appsEnabled: false, current: [] as WorkResultRecord[], history: [] as WorkResultRecord[], pages: [] as WorkResultRecord[][] }));
const lists = vi.hoisted(() => ({ query: vi.fn(), pages: vi.fn(), complete: vi.fn() }));
vi.mock('@/hooks/use-results', () => ({
  useResultCapabilities: () => ({ data: { handoffsEnabled: state.enabled } }),
  useResults: (input: { includeSuperseded?: boolean }) => { lists.query(input); return { data: input.includeSuperseded ? state.history : state.current }; },
  useInfiniteResults: (input: unknown) => { lists.pages(input); return { data: { pages: state.pages }, isPending: false, error: null }; },
  useAcceptResultComplete: () => ({ isPending: false, mutate: lists.complete }),
}));
vi.mock('./result-renderer', () => ({ ResultRenderer: () => createElement('span', null, 'Shared handoff renderer') }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/contexts/dashboard-context', () => ({ useDashboard: () => ({ theme: 'light', toggleTheme: vi.fn(), openAreasList: vi.fn() }) }));
vi.mock('@/components/local-apps/app-hooks', () => ({ useLocalApps: () => ({ enabled: state.appsEnabled }) }));
vi.mock('@/components/tasks/task-list', () => ({ TaskList: () => null }));
vi.mock('@/components/notes/note-list', () => ({ NoteList: () => null }));
vi.mock('@/components/stream/stream-list', () => ({ StreamList: () => null }));
vi.mock('@/components/calendar/calendar-panel', () => ({ CalendarPanel: () => null }));
import { ResultList } from './result-list';
import { TaskResults } from './task-results';
import { ExecutionResultsShortcut } from './execution-results-shortcut';
import { ResultCompletionAction } from './result-completion-action';
import { MobileMoreView } from '@/components/mobile/mobile-more-view';
import { SAVED_RESULTS_COMMAND, PALETTE_COMMANDS } from '@/constants/commands';
import { resultListTitle, uniqueResultPages } from './result-list-presentation';
import { clearPendingResultCompletion, pendingResultCompletion, retainResultCompletion } from './completion-retry';

const result = { id: 'taskless-pruned', title: 'Retained research', body: 'Original durable body', createdAt: '2026-10-07', sourceChatSessionId: null, sourceExecutionId: null, supersedesId: null, attachments: [] } as unknown as WorkResultRecord;
const choice = { id: 'task-1', title: 'Ship work', status: 'todo', statusChangedCount: 7, recurrence: null } as const;
beforeEach(() => { vi.clearAllMocks(); state.enabled = false; state.appsEnabled = false; state.current = []; state.history = []; state.pages = []; });
afterEach(() => vi.unstubAllGlobals());

describe('saved result rediscovery', () => {
  it('reads taskless source-deleted work with gates off and defaults to current snapshots', () => {
    state.pages = [[result]];
    const html = renderToStaticMarkup(createElement(ResultList));
    expect(html).toContain('Retained research');
    expect(html).toContain('/results/taskless-pruned');
    expect(html).toContain('Filter saved results');
    expect(html).toContain('Current saved snapshots');
    expect(lists.pages).toHaveBeenCalledWith(expect.objectContaining({ includeSuperseded: false }));
    expect(lists.complete).not.toHaveBeenCalled();
  });
  it('exposes exact replacement history without claiming paged rows are current', () => {
    state.pages = [[{ ...result, supersedesId: 'earlier-snapshot' }]];
    const html = renderToStaticMarkup(createElement(ResultList, { initialHistory: true }));
    expect(html).toContain('/results/earlier-snapshot');
    expect(html).toContain('including earlier versions');
    expect(html).not.toContain('Current saved snapshots');
    expect(lists.pages).toHaveBeenCalledWith(expect.objectContaining({ includeSuperseded: true }));
  });
  it('derives a readable title for verbatim untitled output and collapses overlapping offset pages', () => {
    expect(resultListTitle({ title: null, body: '# Budget log\n\n[[file:file.png]]' })).toBe('Budget log');
    expect(resultListTitle({ title: null, body: '[[file:file.png]]' })).toBe('Untitled handoff');
    expect(uniqueResultPages([[result], [result, { ...result, id: 'second' }]]).map((row) => row.id)).toEqual(['taskless-pruned', 'second']);
  });
  it.each([false, true])('uses the same route from the palette definition and gated touch menu with apps=%s', (appsEnabled) => {
    state.appsEnabled = appsEnabled;
    expect(PALETTE_COMMANDS).toContain(SAVED_RESULTS_COMMAND);
    expect(SAVED_RESULTS_COMMAND.href).toBe('/results');
    const disabledHtml = renderToStaticMarkup(createElement(MobileMoreView));
    expect(disabledHtml).not.toContain('Saved results');
    expect(disabledHtml.includes('>Apps<')).toBe(appsEnabled);
    state.enabled = true;
    const enabledHtml = renderToStaticMarkup(createElement(MobileMoreView));
    expect(enabledHtml).toContain(SAVED_RESULTS_COMMAND.label);
    expect(enabledHtml.includes('>Apps<')).toBe(appsEnabled);
  });
});

describe('linked result surfaces', () => {
  it('hides an empty task section', () => {
    expect(renderToStaticMarkup(createElement(TaskResults, { taskId: 'task-1' }))).toBe('');
  });
  it('keeps exact task snapshots outside any editable body without copied summary content', () => {
    state.current = [result]; state.history = [result];
    const html = renderToStaticMarkup(createElement(TaskResults, { taskId: 'task-1' }));
    expect(html).toContain('Task results');
    expect(html).toContain('/results/taskless-pruned');
    expect(html).toContain('/results?taskId=task-1');
    expect(html).toContain('Show result history');
    expect(html).not.toContain(result.body);
    expect(html).not.toContain('contenteditable');
  });
  it('retains historical-only task associations and execution shortcuts after disable', () => {
    state.history = [result];
    expect(renderToStaticMarkup(createElement(TaskResults, { taskId: 'task-1' }))).toContain('Earlier saved snapshots are available');
    const html = renderToStaticMarkup(createElement(ExecutionResultsShortcut, { executionId: 'work' }));
    expect(html).toContain('/results?executionId=work');
    expect(html).not.toContain('tab');
    state.history = [];
    expect(renderToStaticMarkup(createElement(ExecutionResultsShortcut, { executionId: 'work' }))).toBe('');
  });
});

describe('explicit acceptance and completion controls', () => {
  const options = (choices: NonNullable<WorkResultDetailResponse['completionOptions']>['choices']): NonNullable<WorkResultDetailResponse['completionOptions']> => ({ choices, completedTaskIds: [], staleReason: null, codeFreshness: 'not_code' });
  it('requires a deliberate task choice when multiple linked tasks qualify', () => {
    const html = renderToStaticMarkup(createElement(ResultCompletionAction, { resultId: 'saved', options: options([choice, { ...choice, id: 'task-2', title: 'Second task' }]) }));
    expect(html).toContain('Select a linked task');
    expect(html).toContain('Second task');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
    expect(lists.complete).not.toHaveBeenCalled();
  });
  it('does not offer taskless completion and disables a superseded snapshot', () => {
    expect(renderToStaticMarkup(createElement(ResultCompletionAction, { resultId: 'saved', options: options([]) }))).toBe('');
    const html = renderToStaticMarkup(createElement(ResultCompletionAction, { resultId: 'saved', options: { ...options([choice]), staleReason: 'superseded' } }));
    expect(html).toContain('newer snapshot');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>/);
  });
  it('keeps unknown code freshness visible without turning it into a verified claim', () => {
    const html = renderToStaticMarkup(createElement(ResultCompletionAction, { resultId: 'saved', options: { ...options([choice]), codeFreshness: 'unknown' } }));
    expect(html).toContain('Code identity is unknown');
    expect(html).toContain('Accept and complete');
    expect(html).not.toContain('verified');
  });
  it('retains the complete uncertain submission for replay after the task count changed or choices disappear', () => {
    const items = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => items.set(key, value), removeItem: (key: string) => items.delete(key) });
    const submitted = { requestId: 'same-request', taskId: 'task-1', expectedStatusChangedCount: 7, runtimeChoice: 'stop_running_agent' as const, acknowledgedChildIds: ['child'], acknowledgedExecutionIds: ['work'] };
    retainResultCompletion('saved', submitted);
    expect(pendingResultCompletion('saved')).toEqual(submitted);
    const html = renderToStaticMarkup(createElement(ResultCompletionAction, { resultId: 'saved', options: { ...options([]), completedTaskIds: ['task-1'] } }));
    expect(html).toContain('Retry acceptance and completion');
    expect(html).toContain('outcome is uncertain');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>/);
    expect(lists.complete).not.toHaveBeenCalled();
    clearPendingResultCompletion('saved');
    expect(pendingResultCompletion('saved')).toBeNull();
  });
});
