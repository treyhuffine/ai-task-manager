# Chat UI gallery

Open `/gallery`, or Settings → General → Chat UI gallery. The gallery brings
interactive chat surfaces into one searchable reference. Onboarding is
intentionally outside its scope.

The page distinguishes three origins:

| Origin | What it means |
| --- | --- |
| Built into Ri | Ri owns the interface. An action can still need an account, an enabled feature or a supported harness. |
| Connected app | A connected service supplies its own supported MCP interface. Availability depends on the service and its account. |
| Ri app kit | An optional library an app author can use. Installed apps decide which components appear and which data is available. |

Examples are always available with fictional records, independent of installed
apps and real account access. The gallery is a reference, not a report of what
the current Home has installed or enabled.

The examples cover email, questions, tool permissions, account approvals,
account access, entity references, edit comparisons, attachments, HTML artifacts,
handoffs, messages between chats, transcript activity, connected app results and app-kit components.

## Where the UI lives

The central index is `src/components/chat-ui/gallery/catalog.ts`. Every entry names
its production source files, origin, requirements, trigger, saved-state behavior
and example states. The page exposes those references under Where this UI lives.
Search includes source paths.

Built-in interfaces share one home at `src/components/chat-ui/`:

- Email: `email/`.
- Structured questions and tool permissions: `questions/`, `permissions/`
  and the shared `pending-input-area.tsx` wrapper.
- Account action and access cards: `approvals/`.
- Entity and app-source chips: `references/`.
- Files, images, HTML documents and previews: `artifacts/`.
- Entity comparisons, undo and history: `edits/`.
- Saved handoffs, feedback and review controls: `handoffs/`.
- Transcript events, grouping and background task displays: `activity/`.
- Message presentation and controls: `messages/`.

Both production surfaces and the gallery import those same modules directly.
Component-specific presentation helpers and tests are colocated with them.
Shared data hooks, domain operations and schema types keep their existing
homes in `src/hooks/`, `src/lib/` and `src/db/types.ts`. Chat/session orchestration
and page-level lists stay with the features that place these components.

Separately owned UI keeps its boundaries:

- Connected app views: `src/components/mcp-apps/` and `packages/mcp-apps-host/`.
- Local app companions: `src/components/local-apps/`.
- Optional app-author components: `packages/app-kit/src/ui/`.

The gallery imports those real app interfaces too, with explicit origin and
installation requirements. Catalog metadata, example data and the fixture
adapter live together in `src/components/chat-ui/gallery/`.
See [the component guide](../src/components/chat-ui/README.md) for ownership and
import examples.

## Isolated previews

Each example runs in an iframe with `sandbox="allow-scripts"`, an opaque origin
and no access to the parent document, real storage or account credentials. It
has a restrictive CSP with `connect-src 'none'` and `form-action 'none'`.

The preview bundle replaces the production tRPC client with an in-memory link
at build time. Production components and their hooks otherwise use their normal
behavior. A separate query cache, disposable browser-storage maps and
`GalleryRuntime` belong to that preview. There is no fallthrough to a live
client. Unknown operations fail explicitly. The one text attachment, and the
fictional PDF's thumbnail and page images, are served by a named in-memory
fetch handler. A sandboxed page can't host the browser's PDF viewer, so the PDF
preview shows those page images, as it does in a browser without a viewer.
HTML previews resolve one fictional file
through a build-only folder URL adapter to a local blob document. The native
HTML viewer and thumbnail renderer stay unchanged. No request is sent to the Home.

Question answers, approvals, undo, handoff decisions and email sends update
only fixture state. The preview logs the simulated outcome. Connected app
examples use the actual MCP view host with a self-contained calculator resource
prepared by the existing resource validator. App-kit examples use its existing
`UiGallery` with a memory client.

Each example is built into a separate self-contained HTML document. Large
viewers and editor dependencies load only when that example is selected.
The main app imports only the gallery shell and catalog. The preview compiler
and fixture client never enter the regular app runtime.

## Development

`pnpm gallery:build` generates `public/chat-ui-gallery/<example>.html`. Those
artifacts are ignored by Git. Install preparation, production build and the
development launcher generate them automatically. Regenerate while a dev server
is running after changing a production component or fixture, then reset the
example in the gallery.

To add an interface:

1. Add the production component under its family in `src/components/chat-ui/`,
   then add its origin, requirements, source references and states to `catalog.ts`.
2. Render the production component in `preview.tsx` under the compile-time
   example selector. Keep state data in `fixtures.ts` and local operations in
   `runtime.ts`.
3. Add the operations the component actually uses to the fixture adapter.
   Keep unknown procedures rejected and network access disabled.
4. Regenerate and exercise the states and interactions on desktop and phone.

`scripts/build-chat-ui-gallery.ts` supplies a compile-time selector and removes
unrelated component imports from each preview. Its framework-link adapter keeps
example navigation inside the fixture. Native component code remains unchanged.

## Verification

```sh
pnpm gallery:build
pnpm exec vitest run src/components/chat-ui/gallery/catalog.test.ts
pnpm exec tsx scripts/chat-ui-gallery-browser-smoke.ts
pnpm exec tsx scripts/chat-ui-gallery-browser-smoke.ts --example=chat-messages
pnpm ts
```

The browser qualification renders every interface, exercises real component
interactions, checks light/dark and desktop/phone layouts, and rejects real API
traffic or missing fixture operations. Screenshots go to
`.work/chat-ui-gallery/`. For iteration against already-generated previews, the
browser script accepts `--skip-build`.
