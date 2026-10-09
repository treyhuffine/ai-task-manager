# Local apps implementation handoff

October 7, 2026. The scoped, owner-trusted local MVP is implemented in the Ri worktree, with Finances source at `apps/finances`. Start with [the trial runbook](local-apps-runbook.md) and [verification evidence](local-apps-progress.md). Production and the original checkouts remain unchanged. The requirements below remain the implementation contract.

October 8 extension: [app and Connector mentions](app-connector-mentions-spec.md), tools-only apps and remembered included-app setup are implemented here on `local-apps-mvp`. [Separate qualification evidence](chat-sources-progress.md) covers source mentions, including an independent build without the local runtime or Finances. Finances is an optional integration consumer. Production connected MCP views in section 9 remain pending under the parent plugin-platform task.

The same extension now explicitly includes [connected MCP apps](app-connector-mentions-spec.md#9-connected-mcp-apps-and-a-common-view-host). Apps is a shared user experience for Ri-managed packages and externally connected services with UI. Their view protocol is MCP Apps, but their storage, execution, account access and lifecycle remain distinct. This restores the external-hosting requirement that the local-runtime design had left out. Existing public/account evaluations remain evidence and fixtures, not production completion.

## Read these together

1. [Product direction](local-apps.md): the user experience, Apps rail, creation/change loop and product boundaries.
2. [Implementation contract](local-apps-implementation.md): authoritative MVP mechanics, interfaces, limits, lifecycle, ordered slices A through G and exit tests. Track implementation status there.
3. [Modularity decision](local-apps-modularity.md): package ownership, direct library integration, interoperability, extraction gates and the option to fold the engine back into Ri.
4. [Finance integration](local-apps-finance.md): the first service app, required adapters, manual/CSV path and separately qualified account connectors.
5. [App and Connector mentions](app-connector-mentions-spec.md): independent source mentions, exact account selection, connected MCP apps, optional local-app views and `@Finances` through the generic adapter.

The implementation contract governs MVP mechanics. The Finance document adds service-specific requirements. The product and modularity documents define the experience and ownership those implementations must preserve. [The earlier plugin proposal](plugins-spec.md) is historical research, not an additional backlog. The [navigation mockup](mockups/ri-apps-navigation.html) illustrates interaction ideas and is not a production UI or a substitute for the requirements.

For the new extension, the mentions specification supersedes earlier mandatory-view, deferred-composer and local-only catalog assumptions. `RI_CHAT_SOURCES` gates source mentions independently of `RI_LOCAL_APPS`. Only the Ri-managed source adapter requires both flags. `RI_MCP_APPS` independently enables qualified connected views. The shared mentions and connected-app host must work without the local runtime, app-kit or Finances, retaining a neutral reusable browser host. Prove this in a separate disposable checkout. Keep shared mentions, connected hosting, local-app adapter and Finances-consumer changes separable. Removing Finances affects only its references, never other sources.

## Settled decisions

- Ri owns navigation, builder/chat, account setup, approvals and the complete user experience. Apps open at `/apps/<slug>/...` and can also participate in existing chats with explicitly scoped view context.
- Apps run on the local Home, with their own files or SQLite data. Small backends use supervised Node children. Finance uses the generic supervised MCP service adapter. Static apps need no backend.
- Views are bundled HTML using the qualified host bridge. React is a supported authoring option, not a required runtime interface. Dependencies follow the pinned build profiles in the implementation contract.
- App access to Ri actions and Connectors passes through scoped host grants. Credentials remain under host control. Background work continues while the Home is running, independently of open views.
- Packages include contracts, documentation and optional workflow skills. Export carries reusable source/artifacts, never personal records, credentials or grants.
- Start with `packages/app-kit` and a native Ri adapter in this repository. Ri imports a library directly. A separate open-source repository is optional after qualification. Absorbing the engine into Ri later preserves app protocols, SDK availability and data formats.

## Build and qualify

Use a separate worktree and disposable Home with `RI_LOCAL_APPS=1`. Follow slices A through G, using fixture accounts and synthetic Finance records first. Preserve the repository's `AGENTS.md` rules and existing Ri services. Do not restart production or use the owner's Home as a test fixture. If this handoff is transferred to another checkout, include all linked current specification files and the mockup, not just this entry document.

Treat exit tests as implementation requirements. The browser containment design needs real browser proof before the view slice passes. Process teardown, authorization/revocation, context isolation, backup/restore and Finance packaging also require the specified tests. A failed qualification test is a defect to resolve or a design change to document before shipping, not permission to silently relax the requirement.

The initial execution profile trusts the app owner and native code, including dependencies/builds. It does not claim a sandbox for hostile third-party code. Public marketplace execution, stronger execution isolation, arbitrary installers/languages, a standalone consumer builder and public ChatGPT distribution are future work. External repository creation is not an MVP dependency. Live Gmail/Plaid qualification and additional operating systems are separate from fixture-based acceptance.

No product decision blocked implementation. Complete the scoped MVP and its tests, record actual qualification evidence, and verify disabling/removing the feature leaves core Ri flows working. Only verified checks are marked complete. This is an opt-in qualified trial, without a production deployment or public release.
