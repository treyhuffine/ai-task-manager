# Team account and connection flow

Initially developed from local main at `2455bf4a`. Integrated with main at `569db68a` before landing, preserving the newer Team-link address, navigation and scheduling behavior.

The member account and the team's reachable address need distinct names and a connection flow that preserves the action the person started.

- [x] Put Your account first in Team settings and rename Remote access to Team address. Preserve existing section URLs.
- [x] Open Your account directly from the sidebar member name and avatar, including a collapsed rail. Show Connect to My Ri for a direct Team viewer and Connected to My Ri inside a personal Home. Keep phone access discoverable.
- [x] Show the saved Team address with a checked online, offline or unconfigured state. Add Check connection and a Beamd Reconnect action using the existing owner-authorized address operations.
- [x] Keep Connect to My Ri and Sign in on another device in the account pane. Show address setup there when needed, and automatically create the requested link after successful setup. Give members a clear owner-directed explanation.
- [x] Apply the same preserved-action behavior to invitations and keep link creation errors recoverable. Never change an address or enable Beamd without an explicit action.
- [x] Verify owner and member behavior, connected personal views, successful and failed setup, status checks, desktop, collapsed rail and phone navigation. Run typecheck, changed-file lint, focused tests and a build.

There are no schema or migration changes. Production and the existing Team service were left running unchanged while this work was tested in isolation.

## Implementation decisions

The account starts with a primary Connect to My Ri action, followed by Profile and Sign-ins. Sign-out is separate. The sidebar action opens this account pane, where the same connection flow runs. A connected personal viewer sees its existing connection instead of another connect action.

The `access` and `remote` settings section IDs remain unchanged. Address checks use the existing revoked, temporary probe to prove the endpoint reaches this Team. They do not open a tunnel or change the saved configuration. The new status procedure is owner-only. Failed checks retain the URL and replace any previously cached Online result with a failed-check state.

Each link action retains its own recovery state in its original pane. Successful address configuration, Beamd reconnection or a manual successful check resumes the requested link creation. Failed setup keeps the entered prefix and the pending action. First-run prefix setup still neither selects a provider nor opens a connection.

The tablet regression check also found agent tool tabs whose visual labels fold away without an accessible name. Their existing labels now supply `aria-label`, preserving access to Files at narrow widths.

## Verification

- 100 focused tests cover settings, account navigation, address operations and Team authorization.
- 20 component browser tests cover navigation, connection recovery and responsive layouts.
- 7 full-app account browser tests cover real Beamd setup, automatic link creation, checked status, failed-check recovery, members and connected personal views.
- 12 existing full-app dashboard browser tests pass for personal and Team views.
- Typecheck and the optimized production build pass. Changed-file lint has no errors, with the existing `_apiKeyId` warning in the Team router.

Before landing, the 100 focused tests and 20 component browser tests were repeated against the updated main. An additional 46 Team-link and signed personal-access tests pass serially. The first concurrent run hit request and test time limits on the busy host. The two opt-in mixed-version tests were not enabled.

The isolated review Team runs on port 42341 at `https://ri-team-account-trey.beamd.run`. Its synthetic owner and member sign-in links are stored in `/Users/agent/ri-sandboxes/team-account-review/preview.json`. The connected synthetic personal Home runs separately on port 42343. Test logs and screenshots are in `/Users/agent/ri-sandboxes/team-account-evidence`.
