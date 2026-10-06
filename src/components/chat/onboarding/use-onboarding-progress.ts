'use client';

import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { UserStateRecord } from '@/db/types';
import { apiErrorText } from '@/lib/api/client';
import {
  baseOnboardingRecord,
  clampReply,
  withChatMoved,
  withFinished,
  withStepRecorded,
  withStepShown,
  type OnboardingRecord,
  type OnboardingStepName,
} from '@/lib/onboarding/progress';
import { trpcClient } from '@/lib/trpc/client';

const USER_STATE_KEY = ['user-state'] as const;

/**
 * The first-run conversation's progress, on the home (`user_state.onboarding`,
 * src/lib/onboarding/progress.ts). Each change shows at once in the cached
 * user state, then settles with what the server stored. Only the onboarding
 * fields are taken from the server's answer, so a setting saved alongside (a
 * name, a look) is never written over by an older copy.
 */
export function useOnboardingProgress() {
  const qc = useQueryClient();
  return useMemo(() => {
    const patch = (change: (record: OnboardingRecord) => OnboardingRecord, extra?: Partial<UserStateRecord>) => {
      const state = qc.getQueryData<UserStateRecord>(USER_STATE_KEY);
      if (!state) return;
      const record = change(baseOnboardingRecord(state.onboarding, state.orchestratorIntroducedAt));
      qc.setQueryData<UserStateRecord>(USER_STATE_KEY, { ...state, ...extra, onboarding: record });
    };
    const settle = (saved: UserStateRecord) => {
      const state = qc.getQueryData<UserStateRecord>(USER_STATE_KEY);
      if (!state) return;
      qc.setQueryData<UserStateRecord>(USER_STATE_KEY, {
        ...state,
        onboarding: saved.onboarding,
        orchestratorIntroducedAt: saved.orchestratorIntroducedAt,
        onboardedAt: saved.onboardedAt,
      });
    };
    const failed = (err: unknown) => {
      // What the server has is the truth to go on from.
      void qc.invalidateQueries({ queryKey: USER_STATE_KEY });
      toast.error('Couldn’t save your setup progress', { description: apiErrorText(err) });
    };

    return {
      /** The question now on screen in this chat. A message sent there instead skips it. */
      show(step: OnboardingStepName, chatId: string) {
        patch((r) => withStepShown(r, step, chatId));
        // Quietly: if this doesn't land, a message just won't skip the question.
        trpcClient.onboardingProgress.show.mutate({ step, chatId }).then(settle, () => {});
      },
      /** A step finished in the conversation, with what they said. */
      record(step: OnboardingStepName, input: { status: 'answered' | 'skipped'; reply?: string; chatId: string }) {
        const reply = input.reply === undefined ? undefined : clampReply(input.reply);
        patch((r) => withStepRecorded(r, step, { status: input.status, reply, chatId: input.chatId, at: new Date().toISOString() }));
        trpcClient.onboardingProgress.record.mutate({ step, ...input, reply }).then(settle, failed);
      },
      /** The conversation is over: finished, or skipped with "Skip setup". */
      finish(input: { skipped: boolean; chatId?: string }) {
        const at = new Date().toISOString();
        const state = qc.getQueryData<UserStateRecord>(USER_STATE_KEY);
        patch((r) => withFinished(r, { ...input, at }), {
          orchestratorIntroducedAt: state?.orchestratorIntroducedAt ?? at,
          onboardedAt: state?.onboardedAt ?? at,
        });
        return trpcClient.onboardingProgress.finish.mutate(input).then(settle, failed);
      },
      /** The empty chat it's in was replaced: the conversation goes with it. */
      async moveChat(from: string, to: string) {
        patch((r) => withChatMoved(r, from, to));
        try {
          settle(await trpcClient.onboardingProgress.moveChat.mutate({ from, to }));
        } catch (err) {
          // The answers still show for this visit, but not after a reload there.
          console.warn('[onboarding] could not move the conversation to its new chat', err);
        }
      },
    };
  }, [qc]);
}
