# MagicPath connector

Added October 19, 2026 through the provider's official hosted MCP service, `https://api.magicpath.ai/mcp`. It is a built-in connector under Developer, beside Figma. Its provider and toolkit identity is `magicpath`, with discovered actions named `magicpath.<tool>`.

## Connection setup

Browser sign-in uses public OAuth discovery, the same profile as Todoist, so the catalog entry carries no auth override. An unauthenticated request returns `401` with a `WWW-Authenticate` challenge naming `https://api.magicpath.ai/.well-known/oauth-protected-resource/mcp`. That metadata advertises the `magicpath:read` and `magicpath:write` scopes. The authorization server at `https://api.magicpath.ai/` supports dynamic client registration, PKCE S256, the `none` and `client_secret_post` token methods, and refresh tokens. Ri requests both scopes because the protected resource advertises them. The provider pins the official endpoint, so a custom server cannot assume MagicPath's identity or trusted annotations.

The owner first connected MagicPath as a custom MCP server named "MagicPath Demo" on the same URL. That connection uses identical OAuth discovery and keeps working. It is a separate identity (`mcp_magicpath_demo`), so it shows a server glyph rather than MagicPath's logo, has no catalog description or starter prompt, and its tools are named `mcp.magicpath_demo.<tool>`. Connecting through the catalog entry gives the logo, the curated starter prompt and the official identity. Remove the custom server afterwards so agents see one MagicPath. Nothing in this change modifies or removes it.

## Tools, quota and interface

MagicPath supplies 42 tools for projects, the shared canvas, components, themes, skills and teams. Ri discovers them rather than hardcoding a snapshot. Every agent tool call counts toward the account's MagicPath API quota, which `get_api_quota` reports. The connect panel says so.

MagicPath's ChatGPT listing opens a full-screen canvas. Its published plugin repository ships only directory metadata for ChatGPT (`.codex-plugin/plugin.json`: icons, descriptions and starter prompts), and the tools MagicPath returns to Ri carry no `_meta` at all: no `ui.resourceUri`, no `openai/outputTemplate` and no `openai/ui` entrypoint. Ri's MCP client does advertise the MCP Apps extension (`io.modelcontextprotocol/ui` with `text/html;profile=mcp-app`). So MagicPath is a tools-only connector in Ri today. It does not appear in the rail's Apps flyout or ⌘K, and has no connected app page, until its server declares a standalone screen to Ri ([docs/connected-mcp-apps.md](../connected-mcp-apps.md)).

## Presentation

- Logo: traced from `assets/magicpath.png` in [MagicPathAI/magicpath-agent-plugin](https://github.com/MagicPathAI/magicpath-agent-plugin) (MIT, commit `3afaaa5`) into one 24 by 24 path, vendored in `scripts/gen-integration-icons.mjs`. Brand color `#085C34` from its plugin manifest.
- Starter prompt: "Create a responsive landing page in MagicPath.", the first of the manifest's `interface.defaultPrompt` entries.

## Sources and validation

- [Plugin README, Authentication](https://github.com/MagicPathAI/magicpath-agent-plugin#authentication) documents the protected resource, both scopes and client-managed OAuth.
- The live unauthenticated challenge, protected resource metadata and authorization server metadata were read on October 19, 2026. No account sign-in, registration or tool call was made against MagicPath for this change.
- `src/lib/integrations/mcp-magicpath.test.ts` drives the real MCP SDK through that captured discovery: dynamic registration, both scopes, PKCE S256, the resource parameter, the code exchange and refresh, for web and desktop callbacks. It also pins the catalog entry, metadata, logo and starter prompt.
