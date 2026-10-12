# Ri app kit

Versioned library exports for contracts, backend SDK, supervision, browser views, build adapters and qualification fixtures. The browser export does not import Node. All runtime state belongs to the host-created engine instance. HostServices supplies authority and storage, never ambient Ri imports.

The native driver runs owner-trusted code. It is not a hostile-code sandbox. Dependencies and builds use the same trust profile. Unsupported profiles and service targets fail before code execution.

Run `pnpm build`, `pnpm typecheck` and `pnpm test` in this package. Qualified targets and evidence are recorded in the Ri implementation documentation.

Host lifecycle tests can use `createOfflineAppTemplate` and `buildOfflineAppFixture` from the testing export. They share the production template and invoke the real compiler against this checkout's installed SDK, React and Zod, then validate and run the bundled artifact. These fixtures do not download dependencies or exercise the build-owner wrapper. Production template creation still packs the SDK and resolves a lockfile, and production builds still install frozen dependencies through the owned runner. Installer and build-parent termination checks belong at that kit boundary, rather than making every host approval or backup test depend on registry availability.

Managed MCP services expose a bounded private `status` summary: readiness, worker started/running and last-run times, pending setup, and at most 100 summarized jobs. `AppEngine.serviceStatus` reads an existing owned transport without starting a stopped service, validates the public summary schema, and rejects a changed process generation. It carries no records, endpoint or credentials. Ri displays it in native app settings.

An optional `ui.access` declaration names an account-selection path and a human callback with `actorId` input and `scopeRef` output. Ri opens that path as the human owner with the chosen host actor in `query.hostActor`. The app binds that actor in its opener scope, renders its own account/permission choices, and returns an opaque reference. Native Ri controls hold the reference and save it only when the human confirms the host grant. No copying of actor IDs or sign-in credentials is required. A guest cannot replace the opener's bound actor.
