# Shared MCP Apps host

`AppViewController` is the browser protocol and containment layer used by both local apps and connected MCP apps. `@ri/app-kit/view-host` re-exports it for existing consumers. App-kit's build inlines this package into `dist/view-host.js` and its declarations into `dist/mcp-apps-host.d.ts`, because apps install the SDK as a packed tarball outside the workspace, where `@ri/mcp-apps-host` does not resolve. Keep it a devDependency of app-kit, and import only packages app-kit already depends on. The app-kit build fails on any other import.

It has no Ri server, account, package manifest, local process, builder, or domain dependencies. Workspace consumers compile the TypeScript entrypoint through their existing bundler. The root Next configuration explicitly transpiles this package.

The host uses the official MCP Apps `AppBridge` over two opaque sandbox frames. It hashes inline scripts, blocks network access, checks the sending window and view binding, and limits message size and rate. Business operations and permissions belong to the adapter callbacks.

Local bindings retain their original result and context envelopes. A `binding.mcp` supplies an ordinary original MCP tool input/result pair. Remote callback results also remain ordinary MCP results, including UI-only metadata. Callbacks can accept standard model context, append a chat draft, resize a view, and change display mode. They do not receive account credentials.

Connected origin authorization and resource validation are in `src/lib/mcp-apps`. The legacy `window.openai` shim lives in that adapter, not in the local app contract. Both origins use this single host.
