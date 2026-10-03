'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Loader2 } from 'lucide-react';
import {
  HarnessSetup,
  harnessName,
  harnessSetupReady,
  initialHarnessSetup,
  type HarnessSetupState,
} from '@/components/onboarding/harness-setup';
import { saveHarnessSetup } from '@/components/onboarding/harness-save';
import { useMainChat, useNewMainChat } from '@/hooks/use-main-chat';
import { apiErrorText } from '@/lib/api/client';
import type { HarnessId } from '@/lib/harness/registry';
import type { EffortLevel } from '@/db/types';
import { Card, PrimaryButton, Says } from './onboarding-ui';
import type { HarnessCheck } from './use-harness-check';

/**
 * Make it the harness Ri runs on, and start the (still empty) main chat over
 * on it if the chat was made on anything else: a chat's harness, model and
 * effort are fixed when it's created, and a new home's first chat is made
 * before any harness is known. Also what the first run's model line saves
 * through when the person changes the pick (`onboarding-default-model.tsx`).
 */
export function useApplyHarness() {
  const qc = useQueryClient();
  const { data: mainChat } = useMainChat(null);
  const newChat = useNewMainChat(null);
  return async (input: { harness: HarnessId; model?: string; variant?: string | null; effort?: EffortLevel | null }) => {
    const saved = await saveHarnessSetup(input);
    // What reads the default (the model line, the model menus) catches up,
    // as it does after "Make default" (`useSetDefaultSelection`).
    void qc.invalidateQueries({ queryKey: ['user-state'] });
    void qc.invalidateQueries({ queryKey: ['agent-models', saved.harness] });
    void qc.invalidateQueries({ queryKey: ['agent-harnesses'] });
    const session = mainChat?.session;
    if (
      session?.harness !== saved.harness ||
      session.model !== saved.model ||
      (session.modelVariant ?? null) !== saved.variant ||
      (session.effort ?? null) !== saved.effort
    ) {
      await newChat.mutateAsync({
        providerId: saved.harness,
        model: saved.model,
        variant: saved.variant ?? undefined,
        effort: saved.effort ?? undefined,
      });
    }
  };
}

/** What the assistant says at the harness step, while it checks and when it needs a hand. */
export function harnessLines(check: HarnessCheck | undefined): ReactNode {
  if (!check || check.status === 'ready') {
    return <Says>One moment, I’m checking which coding tools I can think with on this computer.</Says>;
  }
  const installed = Object.values(check.reports).some((r) => r?.binary.installed);
  return (
    <>
      <Says>
        Before we go on, I need a way to think. I work through a coding tool on your computer, like Codex with your ChatGPT account,
        {installed ? ' and the one here needs a hand.' : ' and I couldn’t find one yet.'}
      </Says>
      <Says>
        Pick one below. I’ll check it’s signed in and send it one short request to be sure it answers.
      </Says>
    </>
  );
}

/**
 * The harness step. Ready from the background check: saved without a word
 * and the conversation moves on (the reply is empty, which isn't shown).
 * Otherwise the picker, starting on what was found, with Continue once a
 * real request has answered.
 */
export function HarnessStep({ check, onDone }: { check: HarnessCheck | undefined; onDone: (reply: string) => void }) {
  const apply = useApplyHarness();
  const [failed, setFailed] = useState<string | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (check?.status !== 'ready' || started.current) return;
    started.current = true;
    apply({ harness: check.harness })
      .then(() => onDone(''))
      .catch((err) => setFailed(apiErrorText(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the check lands ready
  }, [check]);

  if (!check || (check.status === 'ready' && !failed)) {
    return (
      <div className="flex items-center gap-2 px-1 text-[11px] text-muted-foreground">
        <Loader2 size={12} className="animate-spin" /> Checking
      </div>
    );
  }
  return (
    <HarnessPicker
      suggested={check.status === 'attention' ? check.suggested : check.harness}
      problem={failed ?? (check.status === 'attention' ? check.problem : null)}
      onSave={async (state) => {
        await apply({ harness: state.harness, model: state.model });
        onDone(`Use ${harnessName(state.harness)}`);
      }}
    />
  );
}

function HarnessPicker({
  suggested,
  problem,
  onSave,
}: {
  suggested: HarnessId;
  problem: string | null;
  onSave: (state: HarnessSetupState) => Promise<void>;
}) {
  const [state, setState] = useState<HarnessSetupState>(() => initialHarnessSetup(suggested));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = harnessSetupReady(state);

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(state);
    } catch (err) {
      setError(apiErrorText(err));
      setSaving(false);
    }
  };

  return (
    <Card>
      {problem && (
        <p className="mb-3 rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-[11px] text-amber-700 dark:text-amber-400">
          {problem}
        </p>
      )}
      <HarnessSetup
        state={state}
        update={(patch) => setState((s) => ({ ...s, ...(typeof patch === 'function' ? patch(s) : patch) }))}
      />
      {error && (
        <p className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 px-2.5 py-1.5 text-[11px] text-destructive">
          {error}
        </p>
      )}
      <div className="mt-3 flex justify-end border-t border-border pt-3">
        <PrimaryButton disabled={!ready} busy={saving} onClick={() => void save()}>
          Continue <ArrowRight size={12} />
        </PrimaryButton>
      </div>
    </Card>
  );
}
