# Apps layout review

Open `/apps` in the dev app on port 42241. **Apps layout** switches among the twelve versions from the [layout prototypes](mockups/ri-apps-layout-options.html). The arrows step through them, and **Original Apps screen** keeps the previous library available for comparison.

The choice is stored in this browser and also written to the URL, for example `/apps?layout=preview`. Refresh, direct links, and browser Back recover the chosen version. A missing or retired choice falls back to Discover first.

## The twelve screens

| URL value | Screen | Main difference |
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

These are React screens in the normal Ri shell. They use the existing registries, queries, app hosts, account setup, MCP settings, skill builder, and chat components. Switching a layout never creates a separate installation or changes access.

Your library includes installed apps, connected accounts, custom MCP servers, and installed skills. Draft apps and skills appear separately under In progress. Private additions remain in the library. Discover uses the existing provider and included-app catalogs, plus four local starter skills. Previewing a starter creates an editable draft through the existing skills API. The builder owns installation.

Quick access favors optional pins, then recently opened additions. It fits at most six items in one row, reduces that count with available width, and always exposes the complete library. Off, unavailable, and draft items stay in the full library.

Apps and custom MCPs use their actual enable controls. Account access and skill installation keep their existing management semantics. The control screen does not invent a global toggle for a feature whose underlying model has none. Removal stays in the existing management UI.

Add your own opens real app and skill builders, custom MCP setup, app package import, and SKILL.md import. A skill import keeps its original frontmatter, comments, and body, and remains a draft for review. Supporting files are not included in a single SKILL.md import.

App previews use the included catalog's labeled sample records. Opening an installed app mounts the existing app host with its existing permission boundary. Chat layouts use real conversations. Selecting an account there adds its reference to that chat without sending a message.

## Containment and choosing a winner

- `src/components/local-apps/layout-review/layouts/` has one file per candidate.
- `layout-review/options.ts` names them, and `registry.ts` maps names to components.
- `layout-review/shared.tsx`, `items.tsx`, `details.tsx`, and `review.module.css` hold reusable presentation.
- `src/hooks/use-apps-layout-review.ts` owns shared queries and actions. No layout owns a second installed list.
- `layout-review/catalog.ts` adapts existing records and defines the local starter catalog.
- `layout-review/preferences.ts` stores only browser presentation preferences.

There are three small integration points: the library branch in `apps-shell.tsx`, the optional rail slot in `workspaces/rail.tsx`, and an optional callback in `library-chat.tsx` that keeps chat open beside discovery. There are no migrations or backend changes.

To keep a winner, import its component directly in `layout-review/index.tsx`, keep the shared controller/provider, and remove the chooser and Original branch. Delete the other layout files and the registry/options entries. Keep the shared details, library and actions that the winner uses. The rail slot can be removed from `workspaces/rail.tsx` unless Apps rail wins. Pins and recency can remain while the layout preference is retired. The original `app-library.tsx` still supplies connection setup until that reuse is extracted or retained.

## Verification

```sh
pnpm ts
pnpm exec eslint src/components/local-apps/layout-review src/hooks/use-apps-layout-review.ts src/components/local-apps/apps-shell.tsx src/components/local-apps/library-chat.tsx src/components/workspaces/rail.tsx
pnpm exec vitest run src/components/local-apps/layout-review src/components/local-apps/library-model.test.ts src/components/local-apps/library.browser.test.ts src/components/local-apps/apps-rail-list.browser.test.ts
```

The browser suite uses actual layout components against a synthetic API. It replaces existing chat/app runtime hosts to avoid AI calls and starting services, and checks their placement and inputs. It covers all twelve versions at 1440, 390, and 320 px, switching, history and persistence, real mutation payloads, custom MCPs and skills in the library, skill import, connector setup, app tabs, and agent scope changes. A separate dev-app pass exercises all layouts in the actual Ri shell with its live read data.
