import { generateTitle, getProvider, type AgentSession, type GeneratedTitle, type NativeTitleOptions } from '@agentex/agent';
import { getAppRoot } from '@/lib/config/paths';
import { backgroundHarnessUnavailableReason } from '@/lib/executor/harness';
import { harnessDefinition } from '@/lib/harness/registry';
import { runtimeContextForHarness } from '@/lib/harness/runtime';
import { executeHarnessTextOnDevice } from '@/lib/harness/one-shot-runtime';
import { processState } from '@/lib/process-state';
import { perfScope } from '@/lib/perf/recorder';
import type { RunnerSignal, SessionSpec, TitleRequest } from './types';

const FALLBACK_ARGS: Record<import('@/lib/harness/registry').HarnessId, string[]> = {
  claude: ['--tools', '', '--disable-slash-commands'],
  codex: ['--skip-git-repo-check', '-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false', '-c', 'features.multi_agent=false', '-c', 'features.code_mode=false', '-c', 'features.apps=false', '-c', 'web_search="disabled"'],
  cursor: [], opencode: [], antigravity: [],
};

const state = processState('runner.titles', () => ({
  requests: new Map<string, { revision: number; controller: AbortController; work: Promise<void> }>(),
  revisions: new Map<string, number>(),
  writes: new Map<string, Promise<void>>(),
}));

export function cleanChatTitle(value: string): string | null {
  const title = value.trim().replace(/^["'`]+|["'`]+$/g, '').replace(/[.,;:!?]+$/, '').replace(/[\u2013\u2014;]/g, ' ').trim().replace(/\s+/g, ' ');
  return title ? title.length > 60 ? title.slice(0, 59).trimEnd() + '…' : title : null;
}

/** Preserve the ordering of native writes and cancel generation superseded by a rename. */
export async function setRunnerTitle(chatSessionId: string, handle: AgentSession | null, title: string | null, revision: number): Promise<void> {
  if (revision < (state.revisions.get(chatSessionId) ?? -1)) return;
  state.revisions.set(chatSessionId, revision);
  const pending = state.requests.get(chatSessionId);
  if (pending && pending.revision < revision) pending.controller.abort();
  const previous = state.writes.get(chatSessionId) ?? Promise.resolve();
  const work = previous.catch(() => {}).then(async () => {
    if (revision !== state.revisions.get(chatSessionId) || !title || !handle?.setTitle) return;
    await handle.setTitle(title, { timeoutMs: 5000 });
  });
  state.writes.set(chatSessionId, work);
  try { await work; }
  finally { if (state.writes.get(chatSessionId) === work) state.writes.delete(chatSessionId); }
}

/** A manual Ri name wins. An automatic name may have been renamed in the native client while offline. */
export async function syncRunnerTitleSnapshot(
  chatSessionId: string, handle: AgentSession, title: NonNullable<SessionSpec['title']>,
  report: (signal: RunnerSignal) => void,
): Promise<void> {
  if (title.revision < (state.revisions.get(chatSessionId) ?? -1)) return;
  state.revisions.set(chatSessionId, title.revision);
  if (title.source !== 'manual' && !(title.source == null && title.label) && handle.readTitle) {
    try {
      const native = await handle.readTitle({ timeoutMs: 5000 });
      if (native?.trim()) { report({ type: 'native_title', title: native }); return; }
    } catch { /* Retain the Ri name if the metadata source is unavailable. */ }
  }
  await setRunnerTitle(chatSessionId, handle, title.label, title.revision);
}

/** Run on the device that owns the session. No database or app-owned naming inside agentex. */
export function generateRunnerTitle(
  chatSessionId: string, handle: AgentSession | null, request: TitleRequest,
  report: (signal: RunnerSignal) => void,
): Promise<void> {
  const current = state.requests.get(chatSessionId);
  if (current?.revision === request.expectedRevision) return current.work;
  if (request.expectedRevision < (state.revisions.get(chatSessionId) ?? -1)) return Promise.resolve();
  current?.controller.abort();
  state.revisions.set(chatSessionId, request.expectedRevision);
  const controller = new AbortController();
  const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(70_000)]);
  const work = perfScope('timer:chat-title', async () => {
    let result: GeneratedTitle | null = null;
    let reused = false;
    try {
      if (request.reuseExisting && handle?.readTitle) {
        try {
          const title = await handle.readTitle({ signal, timeoutMs: 5000 });
          if (title?.trim()) { result = { title, source: 'native' }; reused = true; }
        } catch { signal.throwIfAborted(); }
      }
      const provider = getProvider(harnessDefinition(request.harness).agentexProviderId);
      const native = handle ?? (provider.capabilities?.nativeTitleGeneration && provider.createSession
        && !backgroundHarnessUnavailableReason(request.harness) ? {
        // An archived chat may have no live handle. Ask the actual native operation
        // on a short-lived control session, without resuming the archived work.
        async generateNativeTitle(description: string, options: NativeTitleOptions = {}) {
          const runtime = await runtimeContextForHarness(request.harness, { cwd: getAppRoot() });
          options.signal?.throwIfAborted();
          const temporary = await provider.createSession!({
            cwd: getAppRoot(), env: runtime.env, signal: options.signal,
            config: { ...runtime.config, ...(request.fallbackModel ? { model: request.fallbackModel } : {}),
              maxTurns: 1, strictMcpConfig: true, mcpServers: [],
              disallowedTools: ['Write', 'Edit', 'NotebookEdit', 'Bash'],
              extraArgs: [...FALLBACK_ARGS[request.harness], ...(request.harness === 'claude' ? ['--setting-sources', ''] : [])],
            },
          });
          try { return await temporary.generateNativeTitle?.(description, options) ?? null; }
          finally { await temporary.close(); }
        },
      } : null);
      result ??= await generateTitle(native, {
        description: request.description, signal, timeoutMs: 30_000,
        fallbackTitleGenerator: async () => {
          if (backgroundHarnessUnavailableReason(request.harness)) return null;
          const model = request.fallbackModel;
          if (!model) return null;
          signal.throwIfAborted();
          const value = await executeHarnessTextOnDevice({
            label: 'chat-title', harness: request.harness, prompt: request.fallbackPrompt,
            model, cwd: getAppRoot(), signal, timeoutSec: 30, maxTurns: 1,
            skipPermissions: false, planMode: true, extraArgs: FALLBACK_ARGS[request.harness],
          });
          return value.text;
        },
      });
      signal.throwIfAborted();
      const title = result ? reused ? result.title : cleanChatTitle(result.title) : null;
      report({ type: 'title_suggestion', title: title ?? (request.truncateOnFailure ? cleanChatTitle(request.description) ?? 'Untitled' : null),
        source: title ? result!.source : request.truncateOnFailure ? 'truncated' : null,
        expectedRevision: request.expectedRevision, syncNative: !reused });
    } catch (error) {
      if (controller.signal.aborted) return;
      console.warn('[chat-title] generation failed:', error);
      if (request.truncateOnFailure) report({ type: 'title_suggestion', title: cleanChatTitle(request.description) ?? 'Untitled', source: 'truncated', expectedRevision: request.expectedRevision });
    }
  }).finally(() => { if (state.requests.get(chatSessionId)?.work === work) state.requests.delete(chatSessionId); });
  state.requests.set(chatSessionId, { revision: request.expectedRevision, controller, work });
  return work;
}
