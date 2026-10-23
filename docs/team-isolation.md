# Deferred Team execution isolation

Owner decision, 2026-10-20. Team agents currently run on the Team server through the ordinary Home runner. Team members are trusted with that server and its OS account. A dedicated or cloud machine is expected. Hosting beside personal Ri is allowed and displays a non-blocking warning to the owner. This accepts access to that OS user's files, personal Ri and signed-in accounts. Application permissions still apply at the Home.

Two further owner decisions apply to the current runner. A connected personal Home represents its signed-in person for Team prompt approvals. Disclosed agent callers are refused on both relays. Background work retains a chat-scoped credential, so while a later turn runs its operations can be attributed to that later requester. Agent tools have no owner-only privilege. Queue admission waits for harness idleness and background work to finish, but this does not create turn-bound credentials. These limits are accepted without a credential redesign.

## Preserved implementation

Local branch `archive/team-isolated-worker` points to `a5697a25cbb2025a2b2fa4301f770bf022c6f527`. It has not been pushed. Keep this ref if the review branch is squash-merged or deleted. The owner may choose to push the archive separately.

The archive contains the isolated worker controller and runtime, model credential and Google identity proxies, harness configuration mapping, worker enrollment, authority leases, sandboxed file helpers, read-only skill bundles, scoped terminals and previews, Linux bubblewrap/container boundaries, Docker packaging, seccomp policy and qualification scripts. Source paths are listed below.

## Evidence and its limits

- Policy fixtures exercised membership, queue receipts, revocation, selected model checks, lease cleanup and shared file/terminal/preview APIs.
- Browser fixtures exercised shared UI, author/document scoping, owner approval controls and narrow layouts.
- Public native Linux binaries exercised synthetic provider transports. Those runs do not prove real account entitlement or complete native stop, attribution or revocation.
- Electron evidence used CDP input against source builds, not native input or a packaged release.
- A previous image exercised enrollment and shutdown. The final image build/recovery gate did not pass. No archived checkbox should be read as proof of that gate.

The archive retains the exact source, screenshots, qualification scripts and evidence records. Existing evidence has known gaps: a stub Home, hardcoded attribution, revocation without an assertion, no native stop and runs that predated the commit recording them. Re-run qualification against the actual final source when isolation returns.

## Findings required before reintroduction

- Bind the approved account revision into every turn.
- Use the mount allowlist on the operator path. `isolatedWorkerDockerArgs` was test-only and its argv did not match the image.
- Cover every forwarded Cursor route and model/billing field in model policy.
- Require the nonce and a destination allowlist for the Google identity CONNECT tunnel.
- Put ACP filesystem callbacks inside the sandbox boundary.
- Close the native evidence gaps above with explicit assertions.
- Follow ordinary personal turn lifetime behavior, with no fixed 15-minute cap.

## Integration seam

Reintroduce isolation as a device placement through `src/lib/workers`, as personal Ri already runs work on a laptop worker. Authorization stays at the Home before dispatch. Agents never enforce their own permissions or write the Home database directly. The capability table gains a named `runOnIsolatedWorker` action. Use the ordinary runner, file, Git, terminal and preview protocols instead of a second Team execution engine.

## Archived file inventory

- `src/app/api/workers/me/execution-scope/route.ts`
- `src/components/team/execution-environment-settings.tsx`
- `src/components/team/legacy-chat-migration-settings.browser.test.ts`
- `src/components/team/legacy-chat-migration-settings.tsx`
- `src/lib/executor/session-mcp-cli.ts` and its container-only test
- `src/lib/db/execution-environments.test.ts`
- `src/lib/db/execution-environments.ts`
- `src/lib/home/execution-enrollment.test.ts`
- `src/lib/home/execution-environment-router.ts`
- `src/lib/home/execution-worker-authority.test.ts`
- `src/lib/home/execution-worker-authority.ts`
- `src/lib/home/execution-worker-lease.ts`
- `src/lib/preview/worker-protocol.ts`
- `src/lib/preview/worker.ts`
- `src/lib/runner/isolation.test.ts`
- `src/lib/runner/isolation.ts`
- `src/lib/runner/runtime-context.test.ts`
- `src/lib/runner/runtime-context.ts`
- `src/lib/skills/runtime-bundle.test.ts`
- `src/lib/skills/runtime-bundle.ts`
- `src/lib/team/ai/cutover.test.ts`
- `src/lib/team/ai/cutover.ts`
- `src/lib/team/ai/runner-profile.test.ts`
- `src/lib/team/ai/runner-profile.ts`
- `src/lib/terminal/isolation.test.ts`
- `src/lib/worker/authority-fingerprint.ts`
- `src/lib/worker/execution-lease.test.ts`
- `src/lib/worker/execution-lease.ts`
- `src/lib/worker/file-helper.ts`
- `src/lib/worker/file-operations.ts`
- `src/lib/worker/google-identity-proxy.test.ts`
- `src/lib/worker/google-identity-proxy.ts`
- `src/lib/worker/harness-wrapper.test.ts`
- `src/lib/worker/harness-wrapper.ts`
- `src/lib/worker/isolated-files.ts`
- `src/lib/worker/isolation.docker.test.ts`
- `src/lib/worker/isolation.test.ts`
- `src/lib/worker/isolation.ts`
- `src/lib/worker/model-credential-proxy.test.ts`
- `src/lib/worker/model-credential-proxy.ts`
- `src/lib/worker/model-request-policy.test.ts`
- `src/lib/worker/model-request-policy.ts`
- `src/lib/worker/previews.ts`
- `src/lib/worker/private-storage.test.ts`
- `src/lib/worker/private-storage.ts`
- `src/lib/worker/redact-event.ts`
- `src/lib/worker/team-auth.test.ts`
- `src/lib/worker/team-auth.ts`
- `src/lib/worker/team-controller.ts`
- `src/lib/worker/team-enrollment.ts`
- `src/lib/worker/team-native-config.test.ts`
- `src/lib/worker/team-native-config.ts`
- `src/lib/worker/team-runtime.test.ts`
- `src/lib/worker/team-runtime.ts`
- `src/lib/worker/team-start.ts`
- `src/worker-runtime/main.ts`
- `worker-runtime/Dockerfile.isolation`
- `worker-runtime/README.md`
- `worker-runtime/fixture-native.mjs`
- `worker-runtime/native-cursor-protocol.mjs`
- `worker-runtime/package.mjs`
- `worker-runtime/qualify-controller.mjs`
- `worker-runtime/qualify-enrollment.mjs`
- `worker-runtime/qualify-file-operations.mjs`
- `worker-runtime/qualify-harness-wrapper.mjs`
- `worker-runtime/qualify-isolation.mjs`
- `worker-runtime/qualify-native-antigravity.mjs`
- `worker-runtime/qualify-native-claude.mjs`
- `worker-runtime/qualify-native-codex.mjs`
- `worker-runtime/qualify-native-cursor.mjs`
- `worker-runtime/qualify-native-opencode.mjs`
- `worker-runtime/qualify-packaged-worker.mjs`
- `worker-runtime/qualify-terminal.mjs`
- `worker-runtime/seccomp/README.md`
- `worker-runtime/seccomp/build.mjs`
- `worker-runtime/seccomp/docker-default.json`
- `worker-runtime/seccomp/upstream.json`

Shared runner, worker, terminal and preview extensions were restored to their pre-container behavior from `d4d33358`. The generally useful same-origin preview refusal and its tests are retained independently.

## Ordinary improvements retained

The preview URL guard remains in the ordinary resolver, with HTTP/HTTPS, credential and same-origin refusal tests. Ordinary preview logs retain their byte and pending-line bounds. The agentex patch retains only explicit free-port allocation for each ordinary OpenCode SDK server, with a two-process regression. The controller password override was removed. Home authorization, member attribution, document scope, queue receipts and the shared worker protocols remain the integration seam.
