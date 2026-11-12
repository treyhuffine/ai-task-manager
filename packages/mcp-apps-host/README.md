# Shared MCP Apps host

`AppViewController` is the browser protocol and containment layer for connected MCP apps, including personal apps built with the shared app kit.

It has no Ri server, account, package manifest, local process, builder, or domain dependencies. Workspace consumers compile the TypeScript entrypoint through their existing bundler. The root Next configuration explicitly transpiles this package.

The host uses the official MCP Apps `AppBridge` over two opaque sandbox frames. It hashes inline scripts, blocks network access, checks the sending window and view binding, and limits message size and rate. Business operations and permissions belong to the adapter callbacks.

A `binding.mcp` supplies an ordinary original MCP tool input/result pair. Remote callback results also remain ordinary MCP results, including UI-only metadata. Callbacks can accept standard model context, append a chat draft, resize a view, and change display mode. They do not receive account credentials.

Connected origin authorization and resource validation are in `src/lib/mcp-apps`. The legacy `window.openai` shim lives in that adapter.
