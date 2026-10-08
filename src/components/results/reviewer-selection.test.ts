import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceRecord } from '@/db/types';
import type { ModelOption } from '@/lib/harness/options';
import type { HarnessId } from '@/lib/harness/registry';

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  pick: null as null | ((harness: HarnessId, model: ModelOption) => void),
}));
vi.mock('@/hooks/use-user-state', () => ({ useUserState: () => ({ data: { defaultHarness: 'claude', defaultModel: 'opus', defaultEffort: 'high' } }) }));
vi.mock('@/hooks/use-workspaces', () => ({ useUpdateWorkspace: () => ({ mutate: state.mutate, isPending: false }) }));
vi.mock('@/hooks/use-harness-models', () => ({ useHarnessModels: (harness: string) => {
  const model = { id: harness === 'codex' ? 'gpt-5.5' : harness === 'antigravity' ? 'gemini-review' : 'opus',
    label: harness === 'codex' ? 'GPT 5.5' : harness === 'antigravity' ? 'Gemini review' : 'Opus',
    supportedEfforts: ['low', 'medium', 'high'] };
  return { data: { defaultModel: model.id, defaultEffort: 'medium', defaultVariant: null }, models: [model] };
} }));
vi.mock('@/components/settings/model-list', () => ({ ModelList: ({ onPick }: { onPick: NonNullable<typeof state.pick> }) => { state.pick = onPick; return null; } }));
vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  PopoverContent: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
  PopoverTrigger: ({ children }: { children: React.ReactNode }) => createElement('div', null, children),
}));
import { ReviewerSelection } from './reviewer-selection';

const workspace = { id: 'research', name: 'Research', reviewBeforeHandoff: null, reviewDefaults: { harness: 'codex', model: 'gpt-5.5', effort: 'low' } } as Pick<WorkspaceRecord, 'id' | 'name' | 'reviewBeforeHandoff' | 'reviewDefaults'>;
beforeEach(() => { vi.clearAllMocks(); state.pick = null; });

describe('explicit scoped reviewer picker', () => {
  it('shows producing agent inheritance and an explicit persistence action without writing preferences', () => {
    const html = renderToStaticMarkup(createElement(ReviewerSelection, { value: {}, onChange: vi.fn(), associatedWorkspace: workspace }));
    expect(html).toContain('Codex · GPT 5.5 · low');
    expect(html).toContain('Inherited from Research.');
    expect(html).toContain('Use for this agent');
    expect(html).toContain('Reset agent reviewer');
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('does not offer an agent persistence action when no producing agent is associated', () => {
    const html = renderToStaticMarkup(createElement(ReviewerSelection, { value: {}, onChange: vi.fn(), associatedWorkspace: null }));
    expect(html).toContain('Claude Code · Opus · high');
    expect(html).not.toContain('Use for this agent');
    expect(html).not.toContain('Reset agent reviewer');
  });

  it('keeps a saved unavailable effort visible and prevents saving a normalized substitute', () => {
    const html = renderToStaticMarkup(createElement(ReviewerSelection, { value: {}, onChange: vi.fn(), associatedWorkspace: { ...workspace, reviewDefaults: { harness: 'claude', model: 'opus', effort: 'ultra' } } }));
    expect(html).toContain('Claude Code · Opus · ultra');
    expect(html).toContain('Saved effort ultra is unavailable');
    expect(html).toContain('ultra (unavailable)');
    expect(html).toMatch(/disabled=""[^>]*>Use for this agent/);
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('changes only the controlled request selection when a model is picked', () => {
    const change = vi.fn();
    renderToStaticMarkup(createElement(ReviewerSelection, { value: {}, onChange: change, associatedWorkspace: workspace }));
    state.pick!('claude', { id: 'opus', label: 'Opus', supportedEfforts: ['low', 'medium', 'high'] });
    expect(change).toHaveBeenCalledWith({ harness: 'claude', model: 'opus', effort: 'medium', variant: null });
    expect(state.mutate).not.toHaveBeenCalled();
  });

  it('keeps the fifth harness selectable and scoped to this review', () => {
    const change = vi.fn();
    const html = renderToStaticMarkup(createElement(ReviewerSelection, {
      value: { harness: 'antigravity', model: 'gemini-review', effort: 'high' },
      onChange: change, associatedWorkspace: workspace,
    }));
    expect(html).toContain('Antigravity · Gemini review · high');
    expect(html).not.toContain('This reviewer choice is unavailable');
    state.pick!('antigravity', { id: 'gemini-review', label: 'Gemini review', supportedEfforts: ['low', 'medium', 'high'] });
    expect(change).toHaveBeenCalledWith({ harness: 'antigravity', model: 'gemini-review', effort: 'high', variant: null });
    expect(state.mutate).not.toHaveBeenCalled();
  });
});
