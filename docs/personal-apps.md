# Personal apps in Ri

Ri's side of the [shared app kit spec](shared-app-kit-spec.md). A personal app is an ordinary MCP server that runs on its own: a background service on the Mac through the kit's `serve --install`, or Cloudflare. Ri doesn't start, stop or supervise it. Ri connects to it with OAuth like any other connector, shows its screens through the connected app host ([connected MCP apps](connected-mcp-apps.md)), and lends it the person's accounts through the hub.

## What Ri owns

| Piece | Where |
| --- | --- |
| Connecting to an app, with OAuth like any MCP server | `src/lib/integrations/mcp-servers.ts` |
| Showing an app's screens | `packages/mcp-apps-host`, `src/lib/mcp-apps/`, `src/components/mcp-apps/` |
| Ri's own services offered to apps (tasks, notes, model, text extraction, web pages) | `src/lib/integrations/hub/ri-services.ts` |

## What was removed

On November 12, 2026, Ri's own app package system was removed, since nobody used it and each thing is now done one way:

- `@ri/app-kit` (`packages/app-kit`), the local app engine (`src/lib/local-apps`), its routes (`/api/local-apps/*`, the `localApps` tRPC router), the catalog and packaging scripts (`apps:catalog`, `apps:dev`, `scripts/local-apps-*`), the builder for app drafts, and its documents.
- The bundled apps: People, Job search, Travel and Bookmarks. Their product specs stay in `docs/` to port later on the kit.
- Finances moved, with its history, to its own repository (`~/dynamism/apps/finances` on the owner's Mac).

Everything is in git history at `3c442810`, the last commit that had it.

Keys made for local apps (`api_keys.role = 'app_client'`) reach nothing now. The proxy refuses them.
