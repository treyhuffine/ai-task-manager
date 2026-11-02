# Team dashboard parity

Branch: `refactor/team-dashboard-parity`, based on `origin/main` at `d0b8020c` (2026-11-02).

Carry the personal application forward as the common application. Keep the team name, shared audience, assignment and member authority explicit. Personal-only workflows and defaults stay unchanged. No production restart or Home migration is part of review.

## Work and acceptance

- [x] Mount the same Dashboard, responsive layouts, power rail, agent tree, Recent list, history and chat selection for both Home kinds.
- [x] Put the team orchestrator directly at Home, alongside shared tasks. Keep AI optional and history readable.
- [x] Use the same resizable TaskSlideout and NoteSlideout with team audience, assignment, revision conflicts, attachments, history and publication controls.
- [x] Preserve standalone and connected-team navigation, legacy URLs, Back/Forward and Home/member-scoped preferences and drafts.
- [x] Keep private Deck, Stream, capture, calendar and personal service settings outside team authority. Preserve member and owner restrictions below the UI.
- [x] Run focused behavior and browser checks, typecheck, lint and build. Provide a seeded isolated comparison instance and testing instructions.

## Experience

Team opens the usual split dashboard with the shared assistant and shared tasks. The familiar rail, agent tree, Recent list, chat workbench and responsive layouts come from the personal application. Board opens in the same full-screen frame. Task and note details use the same complete document sheets, including resizing, nested links, full-width expansion and history. Team supplies the shared audience, assignment, revision-aware autosave, shared-result controls and member authority.

The individual experience keeps its layout, defaults, private Deck, Stream, capture, calendar, scratchpad, onboarding and document chats. Its main-chat header and responsive navigation now live in the common composition. Personal storage keys keep their existing names. Team storage is scoped to its Home and member.

## Decisions

The team assistant is an ordinary team-owned agent, with a managed folder and editable standing instructions. The existing Team AI main-chat reference identifies it, so no schema migration or second execution engine is needed. Enabling AI authorizes this built-in assistant. Reading an AI-off team never creates it. Each member keeps their existing independent current-chat pointer, while history and messages remain shared. Provisioning is one synchronous transaction and does not discover a model or start a harness.

Task and note body writes continue through revision-aware shared autosave. Conflicting text stays local until the member chooses which version to keep. Private planning, subtasks and document chats stay in the personal Home. Contextual Team settings and search retain their authority and appear through the common application chrome. Permanent deletion requires owner authority and an explicit shared-audience confirmation.

## Review instances

The review uses fictional data and separate databases, credentials, attachment folders and ports. The production Home and normal dev Home are untouched.

| Preview | Source | Local address | Disposable root |
| --- | --- | --- | --- |
| New Team | `refactor/team-dashboard-parity` | `http://localhost:42331` | `/Users/agent/ri-sandboxes/team-dashboard-new` |
| Team before the change | `d0b8020c` | `http://localhost:42332` | `/Users/agent/ri-sandboxes/team-dashboard-baseline` |
| Personal, with connected Team | implementation branch | `http://localhost:42333` | `/Users/agent/ri-sandboxes/team-dashboard-personal` |

Each root's `preview.json` contains its owner sign-in link. Team roots also have a member link. These are synthetic credentials and are deliberately excluded from the repository. Use separate browser profiles to compare owner and member behavior in the same Team. Both Team previews contain Field Notes, Maya and Luis, matching tasks and notes, and three agents with synthetic transcripts. No model messages were sent during setup or automated browser testing.

Suggested review:

1. Compare the Team landing screens. Open Recent, a chat, the agent tree, Notes and Board. Click the Team name to return to the shared assistant.
2. Open the onboarding task. Change its title and assignee, resize it, follow the linked working note, return with Back and open the document full width. Reload its deep link.
3. Open the same working note in an owner and a member browser. Make overlapping body edits to see the conflict choices. A member can edit and archive but cannot permanently delete for everyone.
4. Narrow the window to 390px and 900px. Switch Chat, Tasks, Notes and Agents. Open an agent, return to its list and try browser Back/Forward.
5. In the personal preview, check Deck, Stream and Quick Capture. Switch to Field Notes, open a recent chat and reload. The URL stays under the connected Team's `/space/<id>` document.
6. Turn Team AI off in Team settings. Tasks, notes and existing conversations remain readable. Turn it back on when done.

## Recreate a disposable preview

From this worktree, install with `pnpm install` and build with `pnpm build`. Choose a new empty root that is separate from production, dev and test. The seed script refuses an existing database or one of those standard Homes.

```sh
pnpm iso /tmp/ri-team-dashboard-review --init --port 42331 -- pnpm exec tsx scripts/seed-team-dashboard.ts
pnpm iso /tmp/ri-team-dashboard-review --port 42331 -- pnpm exec tsx scripts/serve.ts --port 42331 --hostname 127.0.0.1
```

The server command uses this checkout's production build against disposable data. It does not start or restart production. To seed a personal preview connected to that Team, use another empty root and pass the Team's local `preview.json`:

```sh
pnpm iso /tmp/ri-personal-dashboard-review --init --port 42333 -- pnpm exec tsx scripts/seed-team-personal-preview.ts /tmp/ri-team-dashboard-review/preview.json
pnpm iso /tmp/ri-personal-dashboard-review --port 42333 -- pnpm exec tsx scripts/serve.ts --port 42333 --hostname 127.0.0.1
```

## Verification

Initial parity verification:

- Production build and `pnpm ts` pass. Changed-file ESLint has no errors, with two existing unused-variable warnings in `queries.ts`.
- 83 focused unit and integration tests pass across 16 files, with one skipped test.
- 41 component browser tests pass across eight files, including shared-body draft ownership and attachments, legacy chat links, Team settings, search and the common agent rail.
- Eight full-app browser scenarios pass, including desktop, 390px phone, 900px tablet, conflicting note edits, AI-off history, the personal dashboard and a connected-Team transcript after reload. No unhandled browser errors were recorded.
- Screenshots of both versions and the personal preview were inspected. The final sample title, assignee and note body were restored after editing tests.

The opt-in live browser suite uses the running synthetic previews and the real HTTP/tRPC server, common components and SQLite. It makes no harness sends. Screenshots and logs for the review are outside the repo in `/Users/agent/ri-sandboxes/team-dashboard-evidence`.

```sh
RI_TEAM_DASHBOARD_PREVIEW=/Users/agent/ri-sandboxes/team-dashboard-new \
RI_TEAM_DASHBOARD_PERSONAL=/Users/agent/ri-sandboxes/team-dashboard-personal \
RI_REVIEW_CHROMIUM='/Applications/Brave Browser.app/Contents/MacOS/Brave Browser' \
RI_ARTIFACT_SCREENSHOTS=/Users/agent/ri-sandboxes/team-dashboard-evidence \
pnpm exec vitest run src/components/team/team-dashboard.live.browser.test.ts
```

Provisioning tests cover AI-off content-only Teams, one assistant under concurrent requests, legacy transcript retention, independent member selection, existing configured agents and revoked credentials. Existing suites cover shared autosave, settings authority, connected-Team forwarding, source identity and personal chat recovery.

## Review refinements, 2 November

Main advanced to `94c86f43` during review. That archive fix is merged into the implementation branch.

- [x] Default Team tasks to the left and chat to the right. Keep personal Chat and Deck defaults unchanged.
- [x] Add visible Expand and Restore controls to both Team panels without remounting the chat or losing its draft.
- [x] Keep one Tasks destination in the rail. Start with a list and open the full Board from its toolbar.
- [x] Make the Team badge prominent in the rail, including the collapsed rail.
- [x] Add owner-managed Team logo upload, replacement and removal in General settings. Display it in the rail, shared assistant and current-Team selector.
- [x] Verify desktop expansion, divider restoration, drafts, logo authority, connected-Team upload and responsive behavior. Update the same Beamd preview.

Field Notes is a fictional team name, which may represent a company or any other group. A company is not a new entity or permission layer. The Team logo uses the existing home-wide identity image and generic attachment store. There are no schema changes or migrations. Shared connector administration and local Apps are still outside the Team UI in this change. Team skills and external-agent MCP connections remain available.

Refinement verification: 45 focused unit/integration tests pass (one skipped), 41 existing component browser tests pass, six Board browser tests pass and all ten full-app browser scenarios pass. The production build and typecheck pass. ESLint has no errors and retains existing warnings. Live expansion tests drag the divider, type an unsent draft, expand each panel, restore its exact prior width and confirm the draft remains. The logo browser check uploads through a connected Team, checks the displayed image, verifies member restrictions and removes it.

The review is still at `https://ri-team-parity-trey.beamd.run`, with the owner sign-in link in the personal preview root's `preview.json` as `publicOwnerUrl`. Its My Ri selector opens the connected Field Notes Team. The current review servers run the `.next-team-toolbar` production build. Use `NEXT_DIST_DIR=.next-team-toolbar` with the serve commands above to restart those builds. Field Notes has a sample company mark and its General settings can upload a different one. Production and the normal dev Home remain untouched.


## List organization and personal expansion

- [x] Default Team lists to lifecycle status groups with counts and collapse controls, ordered In progress, Todo, Consider, Done, Archived.
- [x] Sort Team tasks by earliest deadline within groups by default, with undated tasks last. Offer manual priority, recent viewing, creation and update ordering.
- [x] Allow status, assignee, area and no grouping. Remember each Home member's grouping and sort locally. Keep personal list defaults unchanged.
- [x] Keep grouped reordering within its group, including priority bucket actions. Never change status, assignment or area as a side effect of list reordering.
- [x] Add personal Expand/Restore with panel-width visibility and a More fallback, preserving all tabs, drafts and divider size.
- [x] Verify grouping, sorting, persistence, drag behavior, responsive tab fit and personal expansion in browser, then update the Beamd preview.

The prior flat list used manual Priority Order, with unranked tasks newest first. These controls change presentation only. They require no database migration.


List refinement verification: 50 focused checks pass across seven files, including eight List and Board browser scenarios. All 12 full-app browser scenarios pass with no unhandled browser errors. The production build and typecheck pass. Changed-file ESLint has no errors and retains the existing TanStack Virtual compiler warning. The public Beamd preview was opened through a real browser and verified after the server update. Screenshots cover status and assignee groups, the public Team split, expanded personal chat, and personal tabs with the expansion control tucked into More.

Personal expansion uses the panel width, rather than the window width. The direct button appears at 640px, shows its label at 760px, and moves into More below that threshold. A file tab raises the direct-button threshold to 760px. Team's smaller set of tabs allows its button from 360px. Restore stays available while expanded. No personal task defaults, schema, migrations or production services changed. Existing preview records are preserved.

## Board entry action

- [x] Replace the Team home list's List/Board switcher with a primary Open board action using the standard button and a columns icon.
- [x] Keep the label visible in narrow panels and open the existing full Board. Preserve inline view switching where it still changes views in place.
- [x] Verify the action, responsive fit and full Board navigation, then update the existing preview.


Board entry verification: all eight List and Board component browser scenarios and all 12 full-app browser scenarios pass. The real public preview opens and closes the Board through the connected Team. The phone check finds the labeled action, opens the Board and returns to the list. The desktop screenshot confirms a filled button replaces the List/Board switcher. Build, typecheck and changed-file lint pass without errors or warnings. Main remains current at `94c86f43`. That review used `.next-team-board-action`, with existing preview data preserved and no migrations.


## Compact Team list toolbar

- [x] Consolidate status, assignment and area under Filter, and grouping and sorting under View.
- [x] Keep Open board, search and task creation visible in one row at panel widths from 320px through desktop and full-width layouts.
- [x] Verify the screenshot's width, both sides of label breakpoints, long active filters, all menu behavior and personal defaults, then update the existing preview.


Toolbar verification: all nine List and Board component browser scenarios pass. The regression checks five visible actions on one row at 320, 360, 390, 447, 448, 511, 512, 671, 672, 765, 900, 1200 and 1600px, including selected assignment, In progress and a long area name. Status, assignment and area share Filter. Grouping and sorting share View. Active choices remain visible in the list summary. Labels collapse at the panel's width and icon controls use fixed square widths.

All 12 full-app browser scenarios pass without unhandled browser errors. They verify the new Filter against real Team data, saved grouping and sorting, Board navigation, and personal status, sort and energy controls. The public connected-Team browser check verifies one-row geometry at a 764.5px panel width, matching the supplied screenshot, plus 1280, 1440, 1788 and 1920px windows. The crop is `team-toolbar-765.png` in the evidence folder. Build and typecheck pass. Changed-file lint has no errors and retains the existing TanStack Virtual compiler warning. The current preview build is `.next-team-toolbar`. Data, schema and migrations are unchanged.
