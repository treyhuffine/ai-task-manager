/**
 * Scenario registry for the /dev/execution-chat playground.
 *
 * Each scenario is a button on the page. The two paths are intentionally
 * independent — `inject` writes directly to chat_events / pending-input
 * without contacting Claude (instant, deterministic, free) and `live`
 * dispatches a real prompt through the agent (slower, costs tokens,
 * exercises the full executor pipeline). Most scenarios provide both.
 *
 * Scope is "make every meaningful state visible from one click." When
 * you change a card's render or add a new event source, add a scenario
 * here so future-you can verify it without crafting prompts.
 */

import type { PermissionMode } from '@/db/types';

export type ScenarioCategory =
  | 'questions'
  | 'permissions'
  | 'modes'
  | 'transcript'
  | 'lifecycle';

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  description: string;
  /**
   * Body to POST to /api/dev/sessions/[id]/inject. When omitted the
   * scenario only supports the live path (typically because the state
   * we want is best driven by a real agent, e.g. plan-mode behavior).
   */
  inject?: InjectBody;
  /**
   * Sets the session's permission_mode then POSTs the prompt to
   * /api/sessions/[id]/messages so the agent runs it for real.
   * Omitted for scenarios that only make sense via inject (e.g.
   * synthetic transcript states).
   */
  live?: { mode: PermissionMode; prompt: string };
}

// ─── Inject body types (mirror server discriminator) ─────────

export type InjectBody =
  | InjectPendingQuestion
  | InjectPendingPermission
  | InjectFakeEvent
  | InjectBatch
  | InjectClearPending
  | InjectResetSession;

interface InjectPendingQuestion {
  kind: 'pending_question';
  questions: Array<{
    question: string;
    header: string;
    options: Array<{ label: string; description: string; preview?: string }>;
    multiSelect?: boolean;
  }>;
}

interface InjectPendingPermission {
  kind: 'pending_permission';
  toolName: string;
  input: Record<string, unknown>;
  title?: string;
  description?: string;
}

interface InjectFakeEvent {
  kind: 'fake_event';
  source: string;
  content?: string | null;
  tool_name?: string | null;
  tool_input?: Record<string, unknown> | null;
  tool_is_error?: boolean;
}

interface InjectBatch {
  kind: 'batch';
  events: Array<Omit<InjectFakeEvent, 'kind'>>;
}

interface InjectClearPending {
  kind: 'clear_pending';
}

interface InjectResetSession {
  kind: 'reset_session';
}

// ─── Scenarios ────────────────────────────────────────────────

export const SCENARIOS: Scenario[] = [
  // ───────── Questions ─────────
  {
    id: 'q-single',
    category: 'questions',
    title: 'Single question, single-select',
    description: 'Two-option choice. Most common shape.',
    inject: {
      kind: 'pending_question',
      questions: [
        {
          question: 'Which approach?',
          header: 'Implementation strategy',
          options: [
            { label: 'Server-side rendering', description: 'Render on the server, send HTML.' },
            { label: 'Client-side rendering', description: 'Send JSON, hydrate in the browser.' },
          ],
        },
      ],
    },
    live: {
      mode: 'bypass',
      prompt:
        'Use the AskUserQuestion tool exactly once with header "Implementation strategy", question "Which approach?", and these two options: "Server-side rendering" (description: "Render on the server, send HTML.") and "Client-side rendering" (description: "Send JSON, hydrate in the browser."). After receiving the answer, just say "Got it." and stop.',
    },
  },
  {
    id: 'q-multi-select',
    category: 'questions',
    title: 'Multi-select',
    description: 'Pick any subset. Tests the checkbox UI.',
    inject: {
      kind: 'pending_question',
      questions: [
        {
          question: 'Which tools should we install?',
          header: 'Tooling',
          multiSelect: true,
          options: [
            { label: 'Prettier', description: 'Code formatter.' },
            { label: 'ESLint', description: 'Linter.' },
            { label: 'Husky', description: 'Git hooks.' },
            { label: 'Lint-staged', description: 'Run linters on staged files only.' },
          ],
        },
      ],
    },
    live: {
      mode: 'bypass',
      prompt:
        'Use AskUserQuestion with multiSelect: true. Header: "Tooling". Question: "Which tools should we install?". Options: Prettier, ESLint, Husky, Lint-staged with brief descriptions. After receiving the answer, summarize what was selected and stop.',
    },
  },
  {
    id: 'q-multi-question',
    category: 'questions',
    title: 'Multi-question (4)',
    description: 'Steps through four sequential questions. Tests the dot navigation.',
    inject: {
      kind: 'pending_question',
      questions: [
        {
          question: 'Which framework?',
          header: 'Framework',
          options: [
            { label: 'Next.js', description: 'App router, RSC.' },
            { label: 'Remix', description: 'Loaders + actions.' },
            { label: 'SvelteKit', description: 'Adapter-based.' },
          ],
        },
        {
          question: 'Database?',
          header: 'Database',
          options: [
            { label: 'Postgres', description: 'Relational, mature.' },
            { label: 'SQLite', description: 'Embedded, file-based.' },
            { label: 'PlanetScale', description: 'Hosted MySQL.' },
          ],
        },
        {
          question: 'Auth?',
          header: 'Authentication',
          options: [
            { label: 'NextAuth', description: 'Session + OAuth.' },
            { label: 'Clerk', description: 'Hosted auth.' },
            { label: 'Roll your own', description: 'Bearer tokens.' },
          ],
        },
        {
          question: 'Hosting?',
          header: 'Hosting',
          options: [
            { label: 'Vercel', description: 'Native Next deploy.' },
            { label: 'Fly.io', description: 'Edge-region containers.' },
            { label: 'Self-host', description: 'Bare VPS.' },
          ],
        },
      ],
    },
  },
  {
    id: 'q-with-previews',
    category: 'questions',
    title: 'With previews',
    description: 'Each option carries a preview string. (UI does not render previews yet — surfaces the data shape.)',
    inject: {
      kind: 'pending_question',
      questions: [
        {
          question: 'Which color palette?',
          header: 'Palette',
          options: [
            {
              label: 'Warm',
              description: 'Earthy, oranges and browns.',
              preview: '#a86b3c · #c89a6b · #e8c39a · #f7e3c8',
            },
            {
              label: 'Cool',
              description: 'Blues and greys.',
              preview: '#3c5c7a · #6b8aa8 · #9ab6cb · #c8d8e3',
            },
          ],
        },
      ],
    },
  },

  // ───────── Permissions ─────────
  {
    id: 'p-bash',
    category: 'permissions',
    title: 'Bash command',
    description: 'Permission prompt for `pnpm test`.',
    inject: {
      kind: 'pending_permission',
      toolName: 'Bash',
      input: { command: 'pnpm test --filter=core' },
      title: 'Run pnpm test',
      description: 'Runs the test suite for the core package.',
    },
    live: {
      mode: 'default',
      prompt: 'Run `echo hello` in the working directory using the Bash tool.',
    },
  },
  {
    id: 'p-bash-destructive',
    category: 'permissions',
    title: 'Bash (destructive)',
    description: 'Stress the deny path with a scary command.',
    inject: {
      kind: 'pending_permission',
      toolName: 'Bash',
      input: { command: 'rm -rf node_modules' },
      title: 'Delete node_modules',
      description: 'This will remove all installed packages.',
    },
  },
  {
    id: 'p-write',
    category: 'permissions',
    title: 'Write a new file',
    description: 'Permission prompt for Write tool with path + content.',
    inject: {
      kind: 'pending_permission',
      toolName: 'Write',
      input: {
        file_path: '/tmp/example.ts',
        content: 'export const greeting = "hello world";\n',
      },
      title: 'Write /tmp/example.ts',
    },
    live: {
      mode: 'default',
      prompt:
        'Use the Write tool to create a file at /tmp/flow-dev-scratch/example.ts with the content `export const greeting = "hello world";`. Then say done.',
    },
  },
  {
    id: 'p-edit',
    category: 'permissions',
    title: 'Edit existing file',
    description: 'Edit tool with old_string and new_string.',
    inject: {
      kind: 'pending_permission',
      toolName: 'Edit',
      input: {
        file_path: '/Users/you/project/src/app.ts',
        old_string: 'console.log("hi")',
        new_string: 'console.log("hello")',
      },
      title: 'Edit src/app.ts',
    },
  },
  {
    id: 'p-long-input',
    category: 'permissions',
    title: 'Tool with no obvious primary field',
    description: 'Tests the JSON fallback render in the permission card.',
    inject: {
      kind: 'pending_permission',
      toolName: 'CustomTool',
      input: { foo: 'bar', count: 42, nested: { deep: { value: true } } },
    },
  },

  // ───────── Modes ─────────
  {
    id: 'm-plan-flow',
    category: 'modes',
    title: 'Plan mode end-to-end',
    description: 'Switch session to plan and ask for a small feature. Agent should propose a plan instead of editing.',
    live: {
      mode: 'plan',
      prompt:
        'I want to add a "copy to clipboard" button to every code block in the chat transcript. Walk me through your plan.',
    },
  },
  {
    id: 'm-accept-edits',
    category: 'modes',
    title: 'Accept edits — edit allowed, Bash prompts',
    description: 'In accept_edits, edits go through but Bash still surfaces a permission card.',
    live: {
      mode: 'accept_edits',
      prompt:
        'Create a file at /tmp/flow-dev-scratch/notes.md with the content "# notes\\n\\nfirst entry". Then run `wc -l /tmp/flow-dev-scratch/notes.md` to count its lines.',
    },
  },
  {
    id: 'm-default-prompts',
    category: 'modes',
    title: 'Default — every mutating tool prompts',
    description: 'Single edit + single Bash should produce two permission cards.',
    live: {
      mode: 'default',
      prompt:
        'Create /tmp/flow-dev-scratch/two.md with content "two". Then run `cat /tmp/flow-dev-scratch/two.md`.',
    },
  },

  // ───────── Transcript states ─────────
  {
    id: 't-thinking-long',
    category: 'transcript',
    title: 'Long thinking block',
    description: 'Multi-paragraph thinking event. Tests the collapsed/expanded affordance.',
    inject: {
      kind: 'fake_event',
      source: 'thinking',
      content:
        'Let me think through this carefully. The user is asking about caching strategies. There are several approaches:\n\n1. In-memory caching with a TTL — fast but doesn\'t survive restarts.\n2. Redis — persistent, distributed, but adds infrastructure.\n3. File-based caching — simple, persistent, but slower.\n4. Database-backed cache — leverages existing infra but adds query load.\n\nFor this specific use case, where read traffic dominates and the data is small, I think in-memory with a generous TTL is the right call. We can revisit if we hit scale issues.',
    },
  },
  {
    id: 't-tool-storm',
    category: 'transcript',
    title: 'Tool storm (8 calls)',
    description: 'Eight tool calls in a row. Tests scrolling and stacking density.',
    inject: {
      kind: 'batch',
      events: [
        { source: 'tool_call', tool_name: 'Read', tool_input: { file_path: '/src/a.ts' } },
        { source: 'tool_result', content: 'file a contents…' },
        { source: 'tool_call', tool_name: 'Read', tool_input: { file_path: '/src/b.ts' } },
        { source: 'tool_result', content: 'file b contents…' },
        { source: 'tool_call', tool_name: 'Grep', tool_input: { pattern: 'TODO', path: '/src' } },
        { source: 'tool_result', content: '12 matches in 4 files' },
        { source: 'tool_call', tool_name: 'Bash', tool_input: { command: 'ls /tmp' } },
        { source: 'tool_result', content: 'flow-dev-scratch\nfile.txt\nlog.json' },
      ],
    },
  },
  {
    id: 't-big-output',
    category: 'transcript',
    title: 'Big tool output',
    description: '~5KB tool result. Verifies overflow handling in the result card.',
    inject: {
      kind: 'fake_event',
      source: 'tool_result',
      content: Array.from({ length: 80 }, (_, i) => `line ${i + 1}: ${'x'.repeat(50)}`).join('\n'),
    },
  },
  {
    id: 't-error-result',
    category: 'transcript',
    title: 'Tool result — error',
    description: 'tool_is_error=true. Should render with the destructive accent.',
    inject: {
      kind: 'fake_event',
      source: 'tool_result',
      tool_is_error: true,
      content: 'ENOENT: no such file or directory, open \'/missing.txt\'',
    },
  },
  {
    id: 't-rate-limit',
    category: 'transcript',
    title: 'Rate-limit pill',
    description: 'Amber rate_limit pill in the transcript.',
    inject: {
      kind: 'fake_event',
      source: 'rate_limit',
      content: 'Rate limit hit — retrying in 30s',
    },
  },
  {
    id: 't-recap',
    category: 'transcript',
    title: 'Recap divider',
    description: 'Used when an agent resumes from a previous session. Recap divider style.',
    inject: {
      kind: 'fake_event',
      source: 'recap',
      content: 'Resumed conversation from earlier session',
    },
  },
  {
    id: 't-system-divider',
    category: 'transcript',
    title: 'System divider',
    description: 'Plain system event. Should appear as a centered divider.',
    inject: {
      kind: 'fake_event',
      source: 'system',
      content: 'compaction boundary',
    },
  },

  // ───────── Lifecycle ─────────
  {
    id: 'l-result-success',
    category: 'lifecycle',
    title: 'Run completion pill',
    description: 'Green "Run complete" pill at end of a turn.',
    inject: {
      kind: 'fake_event',
      source: 'result',
      content: 'Run complete',
    },
  },
  {
    id: 'l-clear-pending',
    category: 'lifecycle',
    title: 'Clear all pending requests',
    description: 'Cancels every overlay-driving request for this session.',
    inject: { kind: 'clear_pending' },
  },
];

export const SCENARIO_CATEGORIES: Array<{
  id: ScenarioCategory;
  label: string;
  hint: string;
}> = [
  { id: 'questions', label: 'AskUserQuestion', hint: 'Structured choices' },
  { id: 'permissions', label: 'Permissions', hint: 'Allow / deny prompts' },
  { id: 'modes', label: 'Modes', hint: 'Live agent flows' },
  { id: 'transcript', label: 'Transcript states', hint: 'Synthetic events' },
  { id: 'lifecycle', label: 'Lifecycle', hint: 'Resets, completion pills' },
];
