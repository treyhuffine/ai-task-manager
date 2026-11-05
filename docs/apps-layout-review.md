# Apps layout review

Open `/apps` to use the combined library and discovery screen. It takes the split library from option 2, status information from option 10, and goal bundles from option 8. The layout chooser is removed. Stored choices and old `layout` query parameters no longer select a different screen.

The normal dev Home is on port 42241. If another checkout is using it, run this checkout with `pnpm iso <isolated-root> --init --port 42251 -- pnpm dev --port 42251`. The current visual qualification uses an isolated synthetic Home at that port. Production is not restarted.

## The original candidates

The twelve candidate files remain as reference material. They are not imported through the active entry or exposed by a chooser. The [layout prototypes](mockups/ri-apps-layout-options.html) preserve the original comparison.

| Former URL value | Screen | Main difference |
| --- | --- | --- |
| `discover` | Discover first | A single quick access row, then featured discovery and the catalog |
| `split` | Split library | Installed additions in a left pane, discovery on the right |
| `rail` | Apps rail | Installed additions replace the expanded rail's agent list while browsing Apps |
| `collection` | One collection | Installed and available additions together, grouped by purpose |
| `home` | Home discovery | The real Ri chat and daily deck, with discovery beside them |
| `chat` | Beside your chat | The real Ri chat alongside a dedicated discovery pane |
| `preview` | Preview browser | A compact searchable list with an adjacent detail or app view |
| `bundles` | Goal bundles | Small collections organized around an outcome, with individual setup steps |
| `tabs` | App tabs | Discover and actual installed apps in a tab strip |
| `control` | Control center | Installed state and access controls alongside discovery |
| `agent` | Agent tools | An actual agent's account scopes, app grants, skills, and discovery |
| `shelf` | Discovery shelf | An actual installed app above a discovery shelf |

## Shared behavior

The active screen is React in the normal Ri shell. It uses existing registries, queries, app hosts, account setup, MCP settings and the skill builder. No parallel installed state or backend was introduced.

Your library stays on the left, grouped into Apps, Connectors and Skills. Apps open in their own view. Connectors open account management in the adjacent pane. Skills open the instruction editor. Custom MCP servers stay under Connectors, with their custom origin visible. Draft apps and skills appear under In progress. Each group has an explanation and count. The library scrolls independently from discovery, including when it contains many additions.

A compact All, Apps, Connectors and Skills filter sits below Your library and stays visible as the list scrolls. It filters installed items and drafts independently of Discover, works with search, and preserves settings beside the library. The URL's `libraryType` parameter restores the selection on refresh and Back. The existing tab components provide keyboard navigation.

Discover stays on the right, with explicit Apps, Connectors and Skills filters. The search above both panes can find something already owned or something new. Catalog type filters leave the other library groups available. Goal bundles show their contents, which additions are already in the library and individual setup actions. They never connect accounts or install a whole bundle automatically. Private servers and authored skills stay out of public discovery.

Discover renders the complete catalog and all filtered results, with no pagination or Show more step. Initial loading uses skeleton rows in each pending library group and skeleton cards in the catalog. The header and discovery structure stay in place while data arrives. Ready library groups remain usable, and background refreshes retain the existing contents.

Settings open alongside the library. App settings reuse `AppSettingsContent`, the same form used by the existing dialog above an open app, including access, schedules, service status, activity and removal. Apps and custom MCPs use their supported enable controls. Account access and skill installation keep their existing semantics. The old quick-access pin controls are not presented in this screen.

New app, New skill and Add MCP server are always visible above the panes, matching the settings creation actions. Connecting a service starts from its card in Discover. Imports live in a smaller menu. They open real builders, account setup and import operations. A skill import preserves its frontmatter, comments and body and remains a draft. Supporting files are not included in a single SKILL.md import. Discovery includes four local starter skills, which also become drafts until installed from the builder.

App previews use the included catalog's labeled sample records. Installed apps use the existing app host and permission boundary. On narrow screens, the library stacks above Discover and remains scrollable. Opening settings brings the selected pane into view.

Apps has a temporary power-rail override. Every visit starts with the icon strip. The expansion button and the existing rail shortcut toggle the override. Leaving Apps restores the surrounding view's preference. Navigating among apps and settings keeps the current visit's rail choice.

## Containment and choosing a winner

- `src/components/local-apps/layout-review/index.tsx` imports `layouts/split-library.tsx` directly as the active screen.
- The other layout files, `options.ts` and `registry.ts` are retained for reference and are not used to choose a screen.
- `layout-review/shared.tsx`, `items.tsx`, `details.tsx`, and `review.module.css` hold reusable presentation.
- `src/hooks/use-apps-layout-review.ts` owns shared queries and actions. No layout owns a second installed list.
- `layout-review/catalog.ts` adapts existing records and defines the local starter catalog.
- `layout-review/preferences.ts` stores only browser presentation preferences.

`apps-shell.tsx` opens the library. `workspaces/rail.tsx` no longer mounts the experimental rail portal. Dashboard context owns the temporary Apps rail override, used by `power-rail.tsx` and the existing keyboard handler. There are no migrations or backend changes.

The prior candidates can be deleted independently after review. Keep the shared controller, catalog, details, cards and account setup. The original `app-library.tsx` still supplies native connection setup inside the adjacent pane.

## Verification

```sh
pnpm ts
pnpm exec eslint src/components/local-apps/layout-review src/hooks/use-apps-layout-review.ts src/components/local-apps/apps-shell.tsx src/components/local-apps/app-settings-dialog.tsx src/components/dashboard/power-rail.tsx src/components/dashboard/dashboard.tsx src/components/workspaces/rail.tsx src/contexts/dashboard-context.tsx
pnpm exec vitest run src/components/local-apps/layout-review src/components/local-apps/library-model.test.ts src/components/local-apps/library.browser.test.ts src/components/local-apps/apps-rail-list.browser.test.ts
```

The browser suite uses the actual library, settings and setup components against a synthetic API. It covers creation, app and skill navigation, history, settings mutations, frontmatter-preserving imports, goal bundles, empty and failed sources, a large library, and widths from 320 to 1440 px. A separate dev-app pass checks the real shell, rail collapse and restoration, native account/MCP setup and responsive behavior.
