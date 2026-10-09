# Developing Finances with Ri

Finances source lives at `apps/finances` in the same repository and worktree as Ri. It is a normal source directory, with no nested Git repository or submodule. Make coordinated commits from the Ri repository. The original Finance repository at `/Users/agent/code/finance-app`, baseline `bef5b6fb11bb28a5de2216cdd96aee4de8172920`, and its earlier implementation worktree remain available as provenance. The imported source includes those uncommitted local-app changes.

Ri owns navigation, chats, permissions, approvals and supervision. Finance owns its service, calculations, migrations and database. Ri never imports Finance domain code. Finance consumes the shared workspace SDK only through `@ri/app-kit` public exports.

## Development commands

Run these from the repository root:

```sh
pnpm install --frozen-lockfile
pnpm finances:test
pnpm finances:typecheck
pnpm finances:lint
pnpm finances:package
pnpm apps:catalog
pnpm apps:dev --home /absolute/path/to/disposable-home --port 42251
```

`apps:dev` checks Home isolation and port availability, builds the current Finance source and SDK, stages Finance and the tracker in Ri's catalog, then starts an isolated Home with local apps enabled. It defaults to a separate `<dev-home>-apps` Home and port 42251. It does not connect real accounts or stop another Home. Stop it with Ctrl+C. Existing Ri installations and production are not restarted.

`apps:catalog` rebuilds and stages packages without starting a Home. Installing and activating a package is still explicit. An installed app runs a reviewed copy, so changing Finance source does not silently replace code that owns records. The native catalog can stage an update for review while preserving the installed instance and records.

For coordinated iteration, edit Ri and `apps/finances` in this worktree. Ri changes use the normal development server. After app changes, run `pnpm apps:catalog`, return to App library or refresh it, select Review update, and select Use app after checking the preview. Activation keeps the installed account and transaction identities and requires renewed permission review. There is one Git checkout and one commit flow, with separate running services and databases.

Finances is the app's display name. Existing package IDs, `finance_*` actions, resource URIs, data roots and `/apps/finance` links remain compatible with earlier installed packages.

## Portable builds

The workspace uses its root `pnpm-lock.yaml` and links Finance to `packages/app-kit`. Finance's `pnpm-standalone-lock.yaml` is the reviewed independent dependency resolution used only when exporting an app. It does not control workspace installation.

Packaging exports the freshly built SDK to a generated vendor tarball and prepares an isolated portable Finance project under its ignored `.ri-build` folder. It pins the portable manifest to that tarball, refreshes only its local dependency in the standalone resolution, installs with a frozen lockfile and lifecycle scripts disabled, and reuses the actual qualified SQLite addon only at the exact same version and Node ABI. The portable project builds and packages itself without repository imports or workspace links, then is removed.

Generated output lives under `apps/finances/release`. The archive contains a self-contained service, UI, migrations, source, public SDK tarball and standalone lockfile. Ri's catalog staging validates and copies it to `release/local-apps/catalog`. These build outputs are ignored by Git. Installed code and records live under the selected Home's `apps/<instance-id>/package` and `data`, outside the source checkout.

The exported package still runs independently and can rebuild through Ri's public service build adapter. Moving source into this repository changes no app identity, permissions or stored-data format. The qualified managed target remains macOS arm64, Node 26.5.0 and ABI 147.

## Consolidation verification

- [x] Import complete Finance source and local-app changes without generated files, private data or nested Git metadata
- [x] Register Finance explicitly in pnpm and preserve the app's own compiler, tests and lint rules
- [x] Pass root and Finance typechecks, Finance tests and changed-surface lint
- [x] Build and stage a self-contained archive from the shared checkout
- [x] Verify native catalog updates preserve installed records and require activation
- [x] Qualify portable rebuild, scopes and lifecycle through the real Ri Finance integration
- [x] Exercise Finance in a disposable Home through the native browser
- [x] Reconcile instructions and runbook with the shared checkout
