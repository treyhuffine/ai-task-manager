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
| `gallery/` | The catalog, gallery page and isolated preview fixtures |

`PendingInputArea` is the small shared wrapper that selects a question or
permission card from the current pending requests. The cards own their separate
UI state and use the existing pending-input hooks.

## Boundaries

Component-specific presentation helpers and their tests stay beside the
components. Shared data hooks remain in `src/hooks/`, domain operations in
`src/lib/`, and schema-derived types in `src/db/types.ts`.

Chat/session orchestration and page layouts stay in `src/components/chat/` and
`src/components/executions/`. Results list pages and placement controls stay in
`src/components/results/`. Generic UI primitives remain in `src/components/ui/`
and installed AI Elements remain in `src/components/ai-elements/`.

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
