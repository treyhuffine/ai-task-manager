import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { parseHTML } from 'linkedom';
import type { UpdateWorkspaceInput, WorkspaceRecord } from '@/db/types';
import { WORK_RESULT_GUIDANCE_MAX } from '@/lib/instructions/preferences';
import { AgentSetup } from './agent-setup';

type SaveCallbacks = { onSuccess: (row: WorkspaceRecord) => void; onError: (error: Error) => void };
const fixtures = vi.hoisted(() => ({
  workspace: {} as WorkspaceRecord,
  write: vi.fn<(input: UpdateWorkspaceInput, callbacks: SaveCallbacks) => void>(),
  success: vi.fn(),
}));

vi.mock('@/hooks/use-workspaces', () => ({
  useUpdateWorkspace: () => ({ mutate: fixtures.write, isPending: false }),
  useArchiveWorkspace: () => ({ mutate: vi.fn() }),
}));
vi.mock('@/contexts/dashboard-context', () => ({ useDashboard: () => ({ goHome: vi.fn() }) }));
vi.mock('@/hooks/use-areas', () => ({ useAreas: () => ({ data: [] }) }));
vi.mock('@/hooks/use-devices', () => ({ useDevices: () => ({ data: [] }) }));
vi.mock('@/hooks/use-results', () => ({ useResultCapabilities: () => ({ data: { aiReviewEnabled: true } }) }));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: null }) }));
vi.mock('@/lib/trpc/client', () => ({ trpcClient: { gh: { statusGet: { query: vi.fn() } } } }));
vi.mock('@/lib/attachments/client', () => ({ uploadAttachment: vi.fn() }));
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/ui/switch', () => ({ Switch: () => null }));
vi.mock('@/components/shared/emoji-picker', () => ({ EmojiPicker: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/results/reviewer-selection', () => ({ ReviewerSelection: () => null }));
vi.mock('@/components/workspaces/workspace-integrations-section', () => ({ WorkspaceIntegrationsSection: () => null }));
vi.mock('./agent-folders', () => ({ AgentFoldersSection: () => null }));
vi.mock('./agent-skills-section', () => ({ AgentSkillsSection: () => null }));
vi.mock('@/components/workspaces/worktree-scripts-section', () => ({ WorktreeScriptsSection: () => null }));
vi.mock('@/components/workspaces/files-to-copy-section', () => ({ FilesToCopySection: () => null }));
vi.mock('sonner', () => ({ toast: { success: fixtures.success, error: vi.fn() } }));

let root: Root | undefined;
let container: HTMLElement;

function workspace(overrides: Partial<WorkspaceRecord> = {}): WorkspaceRecord {
  return {
    id: 'test-agent', name: 'Test agent', cwd: '/test/agent', isGit: false,
    createdAt: '2026-10-08 12:00:00', updatedAt: '2026-10-08 12:00:00', status: 'active',
    instructions: 'General instructions stay separate.', purpose: null,
    workResultGuidance: 'Original agent handoff preferences.',
    reviewBeforeHandoff: null, reviewDefaults: null,
    attachments: [], emoji: null, areaId: null,
    browserEnabled: true, baseBranch: null, worktreeRoot: null, skipLiveConfirm: false,
    setupCommand: null, startCommand: null, teardownCommand: null, filesToCopy: [],
    ...overrides,
  } as WorkspaceRecord;
}

async function render() {
  await act(async () => root!.render(createElement(AgentSetup, { workspace: fixtures.workspace })));
}

beforeEach(async () => {
  const { window, document } = parseHTML('<!doctype html><html><body></body></html>');
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  fixtures.workspace = workspace();
  fixtures.write.mockReset();
  fixtures.success.mockReset();
  container = document.createElement('div');
  root = createRoot(container);
  await render();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = undefined;
  vi.unstubAllGlobals();
});

function guidance() {
  return container.querySelector<HTMLTextAreaElement>('#agent-work-result-guidance')!;
}

function generalInstructions() {
  return container.querySelector<HTMLTextAreaElement>('textarea[placeholder="Run pnpm ts before every commit. Keep changes small."]')!;
}

function saveButton() {
  return Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
    .find((button) => button.textContent?.trim() === 'Save');
}

function mountedProps<T>(element: Element): T {
  const key = Object.keys(element).find((name) => name.startsWith('__reactProps$'))!;
  return (element as unknown as Record<string, T>)[key];
}

async function edit(value: string, element: HTMLTextAreaElement = guidance()) {
  await act(async () => {
    mountedProps<{ onChange: (event: { target: { value: string } }) => void }>(element)
      .onChange({ target: { value } });
  });
}

async function save() {
  await act(async () => mountedProps<{ onClick: () => void }>(saveButton()!).onClick());
}

async function acknowledge(overrides: Partial<WorkspaceRecord> = {}) {
  const [input, callbacks] = fixtures.write.mock.calls.at(-1)!;
  const row = { ...fixtures.workspace, ...input, updatedAt: '2026-10-08 12:00:01', ...overrides } as WorkspaceRecord;
  await act(async () => callbacks.onSuccess(row));
  fixtures.workspace = row;
  await render();
}

describe('Agent handoff and review preferences', () => {
  it('explains scoped inheritance and keeps general instructions separate', async () => {
    fixtures.workspace = workspace({ workResultGuidance: null });
    await render();
    expect(container.querySelector('label[for="agent-work-result-guidance"]')?.textContent)
      .toBe('Handoff and review preferences');
    expect(container.textContent).toContain('Leave blank to inherit shared preferences.');
    expect(container.textContent).toContain('Used only for handoffs and reviews, not ordinary chat.');
    expect(container.textContent).toContain('Using shared preferences');
    expect(guidance().getAttribute('maxLength') ?? guidance().getAttribute('maxlength'))
      .toBe(String(WORK_RESULT_GUIDANCE_MAX));
    expect(mountedProps<{ value: string }>(generalInstructions()).value).toBe('General instructions stay separate.');
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it('saves only the trimmed guidance change and clears it to inherit shared preferences', async () => {
    await edit('  Include finished-work links.  ');
    expect(fixtures.write).not.toHaveBeenCalled();
    await save();
    expect(fixtures.write.mock.calls[0][0]).toEqual({ id: 'test-agent', workResultGuidance: 'Include finished-work links.' });
    await acknowledge();
    expect(guidance().value).toBe('Include finished-work links.');
    expect(container.textContent).toContain('Preferences saved');
    expect(saveButton()).toBeUndefined();

    await edit(' \n ');
    await save();
    expect(fixtures.write.mock.calls[1][0]).toEqual({ id: 'test-agent', workResultGuidance: null });
    await acknowledge();
    expect(guidance().value).toBe('');
    expect(container.textContent).toContain('Agent preferences cleared. Using shared preferences.');
  });

  it('accepts clean refreshes even when two changes share the same timestamp', async () => {
    fixtures.workspace = workspace({ workResultGuidance: 'Preferences changed elsewhere.' });
    await render();
    expect(guidance().value).toBe('Preferences changed elsewhere.');
    expect(saveButton()).toBeUndefined();
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it('preserves a dirty draft on refresh without writing refreshed fields back', async () => {
    await edit('My unsaved handoff preferences');
    fixtures.workspace = workspace({ instructions: 'Instructions changed elsewhere.', reviewBeforeHandoff: true, updatedAt: '2026-10-08 12:00:02' });
    await render();
    expect(guidance().value).toBe('My unsaved handoff preferences');
    await save();
    expect(fixtures.write.mock.calls[0][0]).toEqual({ id: 'test-agent', workResultGuidance: 'My unsaved handoff preferences' });
    await acknowledge({ updatedAt: '2026-10-08 12:00:03' });
    expect(mountedProps<{ value: string }>(generalInstructions()).value).toBe('Instructions changed elsewhere.');
    expect(saveButton()).toBeUndefined();
  });

  it('applies the latest deferred workspace when a dirty draft is reverted', async () => {
    await edit('My unsaved handoff preferences');
    fixtures.workspace = workspace({ workResultGuidance: 'First external update' });
    await render();
    fixtures.workspace = workspace({ workResultGuidance: 'Latest external update', instructions: 'Latest general instructions.' });
    await render();
    expect(guidance().value).toBe('My unsaved handoff preferences');

    await edit('  Original agent handoff preferences.  ');
    expect(guidance().value).toBe('Latest external update');
    expect(mountedProps<{ value: string }>(generalInstructions()).value).toBe('Latest general instructions.');
    expect(saveButton()).toBeUndefined();
    expect(fixtures.write).not.toHaveBeenCalled();
  });

  it('keeps new typing in multiple fields while an earlier save finishes', async () => {
    await edit('First submitted preferences');
    await save();
    expect(saveButton()?.disabled).toBe(true);
    await edit('New preferences while saving');
    await edit('New general instructions while saving', generalInstructions());
    fixtures.workspace = workspace({ workResultGuidance: 'First submitted preferences', updatedAt: '2026-10-08 12:00:01' });
    await render();
    await acknowledge();
    expect(guidance().value).toBe('New preferences while saving');
    expect(generalInstructions().value).toBe('New general instructions while saving');
    expect(saveButton()?.disabled).toBe(false);
    await save();
    expect(fixtures.write.mock.calls[1][0]).toEqual({
      id: 'test-agent', workResultGuidance: 'New preferences while saving', instructions: 'New general instructions while saving',
    });
  });

  it('retains a failed save for retry', async () => {
    await edit('Keep my unsaved preferences');
    await save();
    await act(async () => fixtures.write.mock.calls[0][1].onError(new Error('Offline')));
    expect(guidance().value).toBe('Keep my unsaved preferences');
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('Your changes are still here.');
    expect(saveButton()?.disabled).toBe(false);
    await save();
    expect(fixtures.write).toHaveBeenCalledTimes(2);
    expect(fixtures.write.mock.calls[1][0]).toEqual({ id: 'test-agent', workResultGuidance: 'Keep my unsaved preferences' });
  });

  it('blocks oversized guidance even when an input callback bypasses maxlength', async () => {
    await edit('x'.repeat(WORK_RESULT_GUIDANCE_MAX + 1));
    expect(guidance().getAttribute('aria-invalid')).toBe('true');
    expect(saveButton()?.disabled).toBe(true);
    await save();
    expect(fixtures.write).not.toHaveBeenCalled();
  });
});
