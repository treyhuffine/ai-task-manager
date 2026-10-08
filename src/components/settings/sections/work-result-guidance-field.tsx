'use client';

import { useEffect, useReducer } from 'react';
import { Button } from '@/components/ui/button';
import { useUserState, useUpdateUserState } from '@/hooks/use-user-state';
import { WORK_RESULT_GUIDANCE_MAX } from '@/lib/instructions/preferences';

type DraftState = {
  draft: string;
  saved: string;
  received: string;
  loaded: boolean;
  saving: boolean;
  feedback: 'idle' | 'saved' | 'cleared' | 'error';
};

type DraftAction =
  | { type: 'receive'; value: string | null }
  | { type: 'edit'; value: string }
  | { type: 'save' }
  | { type: 'saved'; submitted: string }
  | { type: 'error' };

function initialDraft(value: string | null | undefined): DraftState {
  const text = value?.trim() ?? '';
  return { draft: text, saved: text, received: text, loaded: value !== undefined, saving: false, feedback: 'idle' };
}

function draftReducer(state: DraftState, action: DraftAction): DraftState {
  switch (action.type) {
    case 'receive': {
      const text = action.value?.trim() ?? '';
      // Retain refreshes while editing, then apply the latest value if the
      // draft returns to its saved baseline. Pending saves still own the draft.
      if (state.saving || state.draft.trim() !== state.saved) {
        return text === state.received ? state : { ...state, received: text };
      }
      if (state.loaded && text === state.saved && text === state.received) return state;
      return { ...state, draft: text, saved: text, received: text, loaded: true, feedback: 'idle' };
    }
    case 'edit':
      if (!state.saving && action.value.trim() === state.saved && state.received !== state.saved) {
        return { ...state, draft: state.received, saved: state.received, feedback: 'idle' };
      }
      return { ...state, draft: action.value, feedback: 'idle' };
    case 'save':
      return { ...state, saving: true, feedback: 'idle' };
    case 'saved': {
      const saved = action.submitted.trim();
      const unchanged = state.draft === action.submitted;
      return {
        ...state,
        saved,
        // An acknowledged write supersedes snapshots received before it.
        received: saved,
        draft: unchanged ? saved : state.draft,
        saving: false,
        feedback: state.draft.trim() === saved ? (saved ? 'saved' : 'cleared') : 'idle',
      };
    }
    case 'error':
      if (state.draft.trim() === state.saved && state.received !== state.saved) {
        return { ...state, draft: state.received, saved: state.received, saving: false, feedback: 'idle' };
      }
      return { ...state, saving: false, feedback: 'error' };
  }
}

export function WorkResultGuidanceField() {
  const { data: userState, isError: loadError, refetch } = useUserState();
  const updateUserState = useUpdateUserState();
  const [state, dispatch] = useReducer(draftReducer, userState?.workResultGuidance, initialDraft);

  useEffect(() => {
    if (userState) dispatch({ type: 'receive', value: userState.workResultGuidance });
  }, [userState?.workResultGuidance, userState]);

  const dirty = state.draft.trim() !== state.saved;
  const tooLong = state.draft.length > WORK_RESULT_GUIDANCE_MAX;

  async function save() {
    if (!state.loaded || !dirty || state.saving || tooLong) return;
    const submitted = state.draft;
    dispatch({ type: 'save' });
    try {
      await updateUserState.mutateAsync({ workResultGuidance: submitted.trim() || null });
      dispatch({ type: 'saved', submitted });
    } catch {
      dispatch({ type: 'error' });
    }
  }

  const status = state.saving
    ? 'Saving...'
    : state.feedback === 'saved'
      ? 'Preferences saved'
      : state.feedback === 'cleared'
        ? 'Shared preferences cleared'
        : dirty
          ? 'Unsaved changes'
          : state.loaded
            ? 'Leave blank to clear shared preferences.'
            : 'Loading preferences...';

  return (
    <section className="space-y-2" aria-labelledby="work-result-guidance-label">
      <label
        id="work-result-guidance-label"
        htmlFor="work-result-guidance"
        className="block text-[12px] font-medium text-foreground"
      >
        Handoff and review preferences
      </label>
      <p id="work-result-guidance-description" className="text-[11px] leading-relaxed text-muted-foreground/70">
        Shared preferences for how agents hand work back to you and review it. An agent can add its own preferences,
        which take precedence when they conflict. These apply only to handoffs and reviews, not ordinary chat.
      </p>
      <textarea
        id="work-result-guidance"
        aria-describedby="work-result-guidance-description work-result-guidance-status work-result-guidance-limit"
        aria-invalid={tooLong || undefined}
        value={state.draft}
        onChange={(event) => dispatch({ type: 'edit', value: event.target.value })}
        maxLength={WORK_RESULT_GUIDANCE_MAX}
        disabled={!state.loaded}
        placeholder="e.g. When handing work back to me, lead with what changed and what I need to do next. Keep summaries brief and include links to the finished work."
        className="h-48 w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-60"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p id="work-result-guidance-limit" className="text-[11px] text-muted-foreground/60">
          {state.draft.length.toLocaleString()} / {WORK_RESULT_GUIDANCE_MAX.toLocaleString()} characters
        </p>
        <Button size="sm" onClick={save} disabled={!state.loaded || !dirty || state.saving || tooLong}>
          {state.saving ? 'Saving...' : 'Save preferences'}
        </Button>
      </div>
      <p id="work-result-guidance-status" role="status" aria-live="polite" className="text-[11px] text-muted-foreground/60">
        {status}
      </p>
      {state.feedback === 'error' && (
        <p role="alert" className="text-[11px] text-destructive">
          Could not save preferences. Your changes are still here. Try saving again.
        </p>
      )}
      {loadError && !state.loaded && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-[11px] text-destructive">Could not load preferences.</p>
          <Button size="xs" variant="outline" onClick={() => refetch()}>Retry</Button>
        </div>
      )}
    </section>
  );
}
