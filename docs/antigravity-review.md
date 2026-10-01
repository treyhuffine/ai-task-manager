# Antigravity integration review

Reviewed on 2026-10-01 in `ai-task-manager/antigravity-harness`. The initial state matched the handoff exactly: HEAD `5fec53b`, 49 modified files and four new files. The incoming implementation was checkpointed separately before review fixes. Final code commit after rebase: `84fb35f`. Agentex was reviewed read-only. Nothing was merged, pushed or published, and production was not restarted.

## Review and changes

- Registry order now starts with Codex. The explicit `DEFAULT_HARNESS` is Codex, and all missing-preference paths use it. Saved choices, including Claude, still win. No data migration.
- Onboarding, settings, model groups, execution launchers, triggers and runtime setup follow the registry. Codex retains its name and mentions the ChatGPT account.
- Schema harness enums derive from unfiltered known registry ids. Both schema-generation checks reported no changes. No migration file was generated.
- Permission, effort, command, instruction-delivery and cheap-model mappings require an explicit choice for every harness. Cosmetic effort-label overrides and history import formats remain deliberately separate.
- Antigravity accepts only `auto_all` and `plan`. Unsupported modes are refused at write and launch boundaries. Initial execution permissions are stored before a prompt can run. Model, effort and harness changes must preserve a supported permission mode, with incompatible switches refused before replacing the existing chat.
- Visible notices explain the absence of approval prompts. Plan copy describes the CLI's planning behavior without promising a filesystem sandbox. Google's documentation describes the mode as a `/plan` prefix. [Execution modes](https://antigravity.google/docs/cli/modes/)
- Disabled harnesses disappear from pickers and are refused before new execution artifacts or replacement chats are created. Known ids still resolve stored history and resume metadata. Background/title paths also respect rollout flags.
- Effort reaches each capable harness through the shared runner. Auth recovery uses the correct harness's command. A fresh successful check is required after an auth failure, so cached success cannot prematurely offer Resend. Claude's existing login flow remains intact.
- Antigravity background AI fails clearly before spawning: agy ignores the required tool filters and MCP isolation while honoring auto-approval. It does not silently select another harness. Automatic titles use the existing snippet fallback.
- Runtime setup and executable overrides derive from registry metadata. App-root instruction-file participation is exhaustive and explicitly excludes Antigravity's duplicate native file.
- Corrected default-sensitive test fixtures, prevented transfer tests from invoking a real background harness, and repaired an unrelated flaky reorder assertion to test the actual requested ordering.

## Layout decision and screenshots

Selected: a full-width Codex card, followed by a responsive two-column grid. Below a 400px container width, every option becomes a single row. An unpaired final card spans both columns. Settings and onboarding share the picker, and model/settings controls use container queries.

Compared with a single-column list, the featured layout keeps authentication and model controls higher on desktop while retaining the same readable phone layout. Three, four and five visible options all render without horizontal overflow. The comparison changed only grid CSS for the list alternative.

Screenshots use the real onboarding and settings components in the dev app on port 42241, at 390px and 1440px viewport widths. Settings was mounted in a temporary dev review page, removed afterward. Auth, catalogs and settings API responses were browser fixtures, so the pictured signed-in state is illustrative and did not require a login or model turn. Reduced-option captures used actual rollout environment flags and matching fixture data. All 16 renders had no browser errors or horizontal overflow.

| Surface | Selected desktop | Selected phone | Alternative desktop | Alternative phone |
| --- | --- | --- | --- | --- |
| Onboarding | [Featured](images/harness-review/onboarding-featured-desktop.png) | [Featured](images/harness-review/onboarding-featured-phone.png) | [List](images/harness-review/onboarding-list-desktop.png) | [List](images/harness-review/onboarding-list-phone.png) |
| Settings | [Featured](images/harness-review/settings-featured-desktop.png) | [Featured](images/harness-review/settings-featured-phone.png) | [List](images/harness-review/settings-list-desktop.png) | [List](images/harness-review/settings-list-phone.png) |

| Visible options | Onboarding desktop / phone | Settings desktop / phone |
| --- | --- | --- |
| Three | [Desktop](images/harness-review/onboarding-featured-desktop-3-options.png) / [Phone](images/harness-review/onboarding-featured-phone-3-options.png) | [Desktop](images/harness-review/settings-featured-desktop-3-options.png) / [Phone](images/harness-review/settings-featured-phone-3-options.png) |
| Four | [Desktop](images/harness-review/onboarding-featured-desktop-4-options.png) / [Phone](images/harness-review/onboarding-featured-phone-4-options.png) | [Desktop](images/harness-review/settings-featured-desktop-4-options.png) / [Phone](images/harness-review/settings-featured-phone-4-options.png) |

## Agentex fixes required before publication

Paths below are relative to `~/code/agentex/packages/agent/src/`. Reproductions used mock CLIs. Agentex typecheck and 272 tests across ten affected files passed, which did not expose these edge cases.

| Priority | Finding | Location | Required fix |
| --- | --- | --- | --- |
| P1 | An immediate stop during asynchronous `turn_start` can be lost and the turn completes | `providers/antigravity/session.ts:170` | Register/check cancellation before awaiting callbacks and before spawn |
| P1 | A missing resume id can create a fresh conversation without its instructions. Instructions are also consumed before startup/auth succeeds | `providers/antigravity/execute.ts:76`, `session.ts:89`, `session.ts:122` | Preserve required instructions when resume fails and retry them after failed startup |
| P2 | Auth reads the process home instead of the child environment's home, misreporting API billing as subscription auth | `utils/auth.ts:452` | Resolve settings against effective runtime HOME/USERPROFILE |
| P2 | Timeout/abort after a success result kills the process but reports completion | `providers/antigravity/execute.ts:145` | Preserve cancellation/timeout status through shutdown |
| P2 | Explicit default mode inherits saved CLI mode, and `modeId: plan` plus skipPermissions differs from `planMode: true` | `providers/antigravity/runtime.ts:29` | Resolve effective modes consistently and suppress conflicting flags |

Binary discovery, stream parsing, resume syntax, and rule/skill placement were reviewed against provider source and official documentation: [headless protocol](https://antigravity.google/docs/cli/headless), [authentication](https://antigravity.google/docs/cli/install/), [skills](https://antigravity.google/docs/skills/), [rules](https://antigravity.google/docs/rules/). A real signed-in agy turn, real resume, real effort behavior and live Google authentication remain unverified. No login was attempted.

## Verification

Rebased cleanly onto current `main` at `32a66e9`. Final results:

- `pnpm ts`: passed.
- `pnpm test`: 4,766 passed, 25 skipped across 488 files (486 passed, two skipped).
- `pnpm desktop:test`: 364 passed across 39 files.
- Touched-file ESLint: 84 files, zero errors and 13 existing warnings.
- Full `pnpm lint`: unchanged baseline of 120 errors and 111 warnings. All 45 error-containing files are byte-identical to the original branch base.
- `pnpm build`: passed with the normal Turbopack build. Its existing broad file-tracing warning in runtime PATH discovery remains.
- `pnpm db:generate`: no changes, both before and after schema enum consolidation.
- `git diff --check`: passed.

The first final suite run overlapped the production build and hit two unrelated five-second timeouts in image and service lifecycle tests. The complete rerun after the build passed without changes or retries inside tests. Stale generated dev route types from the removed screenshot page were cleared before the final standalone typecheck. The dev/build checks use `~/ri-dev`, test databases use temporary roots, and the dev verification server was stopped afterward.

Turbopack cannot resolve the handoff's agentex symlink outside its inferred root. For normal Turbopack verification only, the same unpublished package was copied into this worktree's node_modules. The upstream package was not modified, and the original symlink was restored after validation. The copied and original dist trees were compared and were identical. [Turbopack root](https://nextjs.org/docs/app/api-reference/config/next-config-js/turbopack)

## Remaining landing steps

1. Have the agentex owner fix the provider issues above and publish `@agentex/agent@0.0.39`.
2. In this branch, run `pnpm up @agentex/agent@0.0.39` to replace the local dependency and update `pnpm-lock.yaml`. Commit the lockfile and rerun typecheck, tests and build against the published package.
3. Have the user sign in through `agy`, then verify an actual turn, resume, plan behavior, effort and reference-folder instructions in the dev home.
4. Merge the reviewed branch into current main once those gates pass.
5. Install from the updated lockfile and build the merged release, then restart through Ri's normal service lifecycle when authorized. No production restart was performed by this review.
