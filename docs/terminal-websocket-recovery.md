# Terminal readiness after a production update

The browser terminal uses its own authenticated WebSocket at `/api/trpc/ws`. Its control, input and output never fall back to HTTP. An HTTP page loading successfully does not establish terminal readiness.

Next's Webpack build searches for instrumentation beside `src/app`. The startup implementation at the repository root was omitted from that build. The custom HTTP host then returned 503 for WebSocket upgrades, and the terminal kept reconnecting locally and through Beamd.

`src/instrumentation.ts` is the Next entry point and delegates to the existing root startup implementation. There is one implementation of the startup work. The public health probe returns 503 with `websocket_unavailable` when the custom host expects WebSockets but its runtime is absent. Native Next and an explicit `RI_TRPC_WS_DISABLED=1` retain their HTTP-only behavior.

Next initializes production instrumentation on its first request. Readiness is checked in the health route after initialization, rather than immediately after the custom server's `prepare()` call.

Verification uses an isolated checkout and temporary Home. Do not build in the checkout whose artifacts a running Home is serving.

```sh
pnpm build --webpack
pnpm cli:build
pnpm exec vitest run src/app/api/health/route.test.ts src/service/http-server.test.ts src/cli/lib/server-launch.test.ts src/lib/realtime/terminal-transport.test.ts src/lib/trpc/ws.integration.test.ts
pnpm iso /tmp/ri-terminal-verification --init --port 48888 -- node dist/cli/index.mjs start --port 48888 --no-open --no-http2
# In a second shell, from that same checkout
pnpm iso /tmp/ri-terminal-verification -- pnpm exec tsx scripts/smoke-trpc-websocket.ts http://127.0.0.1:48888
```

The smoke verifies authenticated terminal creation, listing, resize, keyboard input, output and cursor replay through the packaged production host while ordinary API traffic uses HTTP. Live verification must also check an authenticated WSS connection through the actual public URL, since a proxy can serve HTTP while blocking upgrades.

This fix changes no database schema, account credentials or terminal permission checks. Home activation waits for active chats, background work and pending approvals to finish.

Verified October 5, 2026 against committed main plus this fix: 45 focused tests, type checking, targeted lint, Webpack production and CLI builds passed. The packaged production smoke passed across nine domains. A fresh browser also opened a Home terminal, created its own shell, typed a command and received the shell output over WebSocket. Those shells were closed after the check.
