# Shared chat interfaces

Ri's built-in interactive chat components live here. Main chat, focused chats,
execution transcripts, entity views and the gallery import the same components.
Import the component you need directly from its family, for example:

```tsx
import { EmailComposer } from '@/components/chat-ui/email/email-composer';
import { MessageFileChip } from '@/components/chat-ui/artifacts/message-file-chip';
import { PendingInputArea } from '@/components/chat-ui/pending-input-area';
```

| Family | Components and responsibility |
| --- | --- |
| `chat-transcript.tsx` | Common event grouping, paging, scroll anchoring and subagent navigation. Personal and team adapters provide data and attribution slots. |
| `chat-composer.tsx` | Common composer layout around `ChatInputEditor` and contextual actions. Transport, receipts and allowed tools stay in their adapters. |
| `chat-capabilities.tsx` | Explicit delivery and result interactions, without enabling personal endpoints in a team transcript. |
| `email/` | Shared email draft editor and delivery receipt |
| `questions/` | Structured questions, answer choices and free-form answers |
| `permissions/` | Tool permission requests and their input preview |
| `approvals/` | Account action approvals and account access requests |
| `references/` | Task, note, scratchpad and app-source reference chips |
| `artifacts/` | Files, images, HTML previews, the preview provider (large or beside the chat) and file diffs |
| `edits/` | Entity change chips, comparison dialogs, undo and history controls |
| `handoffs/` | Saved handoff rendering, feedback, review and presentation helpers |
| `activity/` | Transcript events, grouped activity and background task displays |
| `messages/` | Agent response markup, copy controls, linked chat origins and sent receipts, voice indicators |
| `model-menu/` | Searchable model rows, effort, variants and speed controls |
| `gallery/` | The catalog, gallery page and isolated preview fixtures |

`PendingInputArea` is the small shared wrapper that selects a question or
permission card from the current pending requests. The cards own their separate
UI state and use the existing pending-input hooks.

Message copy buttons stay visible on touch devices and devices without hover.
Coarse pointers get a 44 px tap target. With a mouse, user-message copy buttons
appear on row hover or button focus, while agent-message copy buttons stay
visible. These controls are shared across chat surfaces.

Active collaboration and incoming pause appear inside the composer card, above
the editor. The status, linked chat and pause action share its border and width.
Idle chats have no status row. Standing preferences remain in the chat menu.
The coordination gallery uses this same composition, including long chat titles.

## Boundaries

Component-specific presentation helpers and their tests stay beside the
components. Shared data hooks remain in `src/hooks/`, domain operations in
`src/lib/`, and schema-derived types in `src/db/types.ts`.

Chat/session orchestration and page layouts stay in `src/components/chat/` and
`src/components/executions/`. Results list pages and placement controls stay in
`src/components/results/`. Generic UI primitives remain in `src/components/ui/`
and installed AI Elements remain in `src/components/ai-elements/`.

`ExecutionTranscript` is the personal data adapter. Team chats consume the same
`ChatTranscript`, adding member authors and serialized-turn status around its
events. Team history omits provider raw payloads. AI off keeps that history
readable. Both composers use `ChatInputEditor`. The retained legacy tool-only
team runtime has an explicit attachment capability of false until its replacement
execution environment is qualified. This extraction alone does not enable that
replacement runtime.

The app kit remains the optional `@ri/app-kit` package. Connected app view hosts
remain in `src/components/mcp-apps/`, local app companions in
`src/components/local-apps/`, and their shared host in `packages/mcp-apps-host/`.
The gallery imports their actual UI and labels its origin and requirements.
No installed app or account is required to explore those fictional examples.

## Adding a chat interface

1. Add the reusable component and any presentation helpers under its family.
2. Import it from the chat or feature surface that displays it.
3. Add an entry to `gallery/catalog.ts` with its source paths, origin,
   requirements and meaningful states.
4. Reuse that component in `gallery/preview.tsx` with fictional data and local
   operations. Keep live APIs out of the preview.

See [the gallery documentation](../../../docs/chat-ui-gallery.md) for the
preview architecture and verification commands.
