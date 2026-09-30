'use client';

import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useRuntimeStatus } from '@/hooks/use-execution';
import { hasRuntimeActivity } from '@/lib/executor/runtime-status';
import { SKILLS_KEY } from '@/hooks/use-skills';
import type { ChatSessionRecord } from '@/db/types';

/** 'build' is the skill's builder chat, 'try' the chat that tries it. */
export type SkillChatKind = 'build' | 'try';

const ENTITY_TYPE: Record<SkillChatKind, 'skill' | 'skill-try'> = { build: 'skill', try: 'skill-try' };

export function skillChatQueryKey(name: string, kind: SkillChatKind) {
  return ['document-chat', ENTITY_TYPE[kind], name] as const;
}

/** Ensure the skill's builder or try chat and return its session id. */
export async function ensureSkillChat(name: string, kind: SkillChatKind): Promise<ChatSessionRecord> {
  const { session } = await api.get<{ session: ChatSessionRecord }>('/document-chat', {
    query: { entityType: ENTITY_TYPE[kind], entityId: name },
  });
  return session;
}

/**
 * A skill's builder or try chat: the same focused content session the
 * note and task chats use (src/app/api/document-chat), tagged with the skill.
 * When a builder turn ends, the skill is refetched so the AI's last edits are
 * in the editor.
 */
export function useSkillChat(name: string, kind: SkillChatKind, opts: { enabled?: boolean } = {}) {
  const qc = useQueryClient();
  const queryKey = skillChatQueryKey(name, kind);
  const query = useQuery({
    queryKey,
    queryFn: () => ensureSkillChat(name, kind),
    enabled: opts.enabled ?? true,
    staleTime: 30_000,
  });
  const sessionId = query.data?.id ?? null;
  const runtime = useRuntimeStatus(sessionId);
  const isActive = hasRuntimeActivity(runtime.data);

  const wasActive = useRef(isActive);
  useEffect(() => {
    if (wasActive.current && !isActive) void qc.invalidateQueries({ queryKey: SKILLS_KEY });
    wasActive.current = isActive;
  }, [isActive, qc]);

  const newChat = useMutation({
    mutationFn: () =>
      api.post<{ session: ChatSessionRecord }>('/document-chat', { entityType: ENTITY_TYPE[kind], entityId: name }),
    onSuccess: (data) => qc.setQueryData(queryKey, data.session),
  });

  return { session: query.data ?? null, sessionId, isActive, isLoading: query.isLoading, error: query.error, refetch: query.refetch, newChat };
}
