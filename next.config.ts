import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@beamd/cli` is a binary launcher — Flow resolves its native per-platform
  // binary via `require.resolve` and execs it. It must stay external so the
  // production build doesn't bundle/rewrite that resolution (which breaks the
  // launch in `next start`). Same rationale as the native deps below.
  //
  // The `@agentex/*` packages are Node SDKs that spawn CLI processes (claude,
  // codex, git, gh), resolve binaries off PATH, and hold process-wide
  // module-scope state (provider registry, auth cache, session maps). They
  // must stay external so (a) the bundler doesn't rewrite binary/process
  // plumbing and (b) Node's module cache keeps a single state instance per
  // process — bundling can duplicate module state across dev compilations,
  // which is exactly the failure mode the `globalThis` stashes in
  // `pending-input.ts`/`adapter.ts` guard against. Externalizing also removes
  // their ~160-module graph from every server-route compile.
  serverExternalPackages: [
    "better-sqlite3",
    "sqlite-vec",
    "node-pty",
    "@beamd/cli",
    "@agentex/agent",
    "@agentex/workspace",
    "@agentex/github",
  ],
  // The connector engine is a workspace package shipped as raw TS (zod-only core);
  // Next must transpile it (and its subpath exports) to consume it from routes.
  transpilePackages: ["@connectors/engine"],
  // Honor NEXT_DIST_DIR so the smoke-test server can boot alongside a
  // running `pnpm dev` without fighting for `.next/dev/lock`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // StrictMode's dev-only double-fire of effects was causing real
  // user-facing bugs (rail mark-read triggered on the synthetic fake
  // unmount, before the user had seen the row). Effect cleanups here
  // are intentionally side-effectful — turning StrictMode off keeps
  // dev behavior aligned with prod.
  reactStrictMode: false,
  // Permit HMR / dev sockets when the user fronts the dev server with a
  // tunnel (ngrok, Tailscale magic DNS, LAN IP, portless.sh) and visits
  // from a remote client. Without this, the WebSocket origin check
  // rejects the connection and HMR silently dies. Production builds
  // ignore this option.
  allowedDevOrigins: [
    "*.ngrok.io",
    "*.ngrok-free.app",
    "*.ts.net",
    "*.localhost",
  ],
};

export default nextConfig;
