# Apps library

Apps at `/apps` is the shared library for local apps, connected services, custom MCP servers, and skills. Settings → Plugins retains its existing tabs, creation controls, and management flows during this transition. Both surfaces operate on the same accounts and records.

## Product behavior

- **Your library** shows installed apps, connected services, custom servers, skills, and drafts. Search includes account labels and skill project names. All, Apps, Connectors, and Skills filters narrow the same library.
- **Discover** combines the included app catalog with the existing connector catalog. Connecting a service from here opens its account setup inside Apps. Search and filters survive detail navigation and browser Back.
- **Build** starts an app draft or a skill draft using the existing builders.
- **Add** offers the catalog, service connection, custom MCP setup, and app package import. Included apps retain their preview, sample-data, activation, and update workflows.
- **Works in chat** describes tools. **Opens in Ri** identifies local apps with views and connected MCPs that offer an interface, a standalone screen or interactive results. Skills say **Agent workflow**. A connected app opens its native page, with Try in chat and its recent results, before any tool executes. The page has no tool forms (`docs/connected-mcp-apps.md`).
- Multiple accounts belong to one service card. Provider-managed MCP servers stay under their provider. A standalone custom MCP server appears once, even when ingestion also exposes it as a provider.
- Disabled, unavailable, or retired connections stay manageable. One failed catalog does not hide the other sources.

Apps remains reachable from desktop navigation, mobile More, and search when local app execution is disabled. Local app build/import actions honor the existing runtime flag. Individual launchers in the rail, search, and companion picker only list apps with a view. The rail's Apps flyout and search also list connected MCPs that declare a standalone screen, one per service (`docs/rail.md`). A service whose interface only comes back as a tool result, such as Todoist, stays in this library, Connectors and `@`.

## Chat and access

Use in chat on a local app opens its existing Ask Ri companion. For a connection, it resolves sources through the existing chat-source API, asks which exact account to reference, and appends that source chip to the main chat draft. It preserves typed text and existing chips, does not send a message, and does not grant access. The handoff is scoped to a chat ID and remains pending until that editor can accept it. Normal editor draft persistence takes over after insertion.

Mentions are always on. Harness support checks still apply. Unsupported sources are disabled with an explanation, and when no account can be referenced the dialog offers an ordinary chat without claiming it has inserted a reference. Existing source resolution and send-time access checks remain authoritative.

Sign-in initiated from Apps returns to its Apps destination. Adding a custom server returns to the library after web sign-in. Reconnecting an existing server returns to its detail. Settings keeps its existing return path. Custom MCP return destinations are validated with `safeReturnPath` before being handed to authorization.

Connected MCP UI hosting, inline results, and the shared view renderer are described in [Connected MCP apps](connected-mcp-apps.md). A public marketplace and new cross-service permission grants remain separate work.

## Implementation and checks

`components/local-apps/library-model.ts` derives library entries from the existing local app registry, integrations queries, and skill overview. It creates no second registry. `use-library.ts` reads those sources independently. The account and custom MCP components accept optional Apps navigation while retaining Settings as their default.

`lib/client/source-handoff.ts` carries exact references between the library and composer within the current browser tab, with an optional one-line starter prompt for Try in chat. The editor hydrates its saved draft before consuming a handoff and avoids inserting an identical chip twice. A chip with a prompt goes on a line of its own below any typed text.

Targeted qualification:

```sh
pnpm ts
pnpm exec vitest run src/components/local-apps/library-model.test.ts src/components/local-apps/library.browser.test.ts src/components/local-apps/app-places.test.ts src/lib/client/source-handoff.test.ts src/lib/chat-sources/editor.browser.test.ts src/components/settings/sections/plugins/navigation.test.ts src/components/results/result-surfaces.test.ts src/app/api/integrations/mcp-servers/oauth-return-route.test.ts src/lib/integrations/oauth-return.test.ts
```

The browser tests render the actual library, setup components, and Settings Plugins with a synthetic API. They check mobile overflow, capabilities, exact-account selection, creation routes, partial failures, disabled local execution, and existing Settings navigation. Composer tests cover draft preservation, duplicate insertion, and chat isolation. OAuth route tests retain the Settings default and reject external return destinations.

For a dev preview, run `pnpm dev:web` and open `http://localhost:42241/apps`. This uses the dev Home and does not require restarting production.
