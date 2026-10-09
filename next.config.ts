import type { NextConfig } from "next";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

const distDir = process.env.NEXT_DIST_DIR || ".next";
const typeScriptConfigs: Record<string, string> = {
  ".next": "tsconfig.json",
  ".next-desktop": "tsconfig.desktop.json",
  ".next-desktop-dev": "tsconfig.desktop-dev.json",
  ".next-smoke": "tsconfig.smoke.json",
};

/** Keep custom builds from appending their route caches to the root tsconfig. */
export function typeScriptConfigPath(outputDir: string, root = process.cwd()): string {
  if (typeScriptConfigs[outputDir]) return typeScriptConfigs[outputDir];

  // Keep this file beside tsconfig.json so inherited paths and Next's generated
  // include globs resolve from the repository root. It must also survive Next
  // clearing the output folder at the beginning of a build.
  const key = createHash("sha256").update(outputDir).digest("hex").slice(0, 16);
  const name = `tsconfig.next-${key}.json`;
  const file = path.join(root, name);
  const content = JSON.stringify({
    extends: "./tsconfig.json",
    include: [
      "**/*.ts", "**/*.tsx", "**/*.mts",
      `${outputDir}/types/**/*.ts`, `${outputDir}/dev/types/**/*.ts`,
    ],
  }, null, 2) + "\n";
  if (!existsSync(file) || readFileSync(file, "utf8") !== content) {
    const temporary = `${file}.${process.pid}.tmp`;
    writeFileSync(temporary, content);
    renameSync(temporary, file);
  }
  return name;
}

const nextConfig: NextConfig = {
  // Each build checks its own generated routes. Sharing one tsconfig lets
  // Next append every output folder, including stale routes from other builds.
  typescript: { tsconfigPath: typeScriptConfigPath(distDir) },
  // Match the bounded multipart reader so attachments and app archives can
  // reach their handlers without the proxy truncating them at its 10 MiB default.
  experimental: { proxyClientMaxBodySize: 51 * 1024 * 1024 },
  // `@beamd/cli` is a binary launcher — Ri resolves its native per-platform
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
    "@ri/app-kit",
    "better-sqlite3",
    "sqlite-vec",
    "node-pty",
    "ws",
    // Tracked subscription envelopes carry a module-local symbol. HTTP and
    // instrumentation must use one Node instance, including after hot reload.
    "@trpc/server",
    "@beamd/cli",
    "@agentex/agent",
    "@agentex/workspace",
    "@agentex/github",
  ],
  // The integration engine is a workspace package shipped as raw TS (zod-only core);
  // Next must transpile it (and its subpath exports) to consume it from routes.
  transpilePackages: ["@integrations/engine"],
  // Honor NEXT_DIST_DIR so the smoke-test server can boot alongside a
  // running `pnpm dev` without fighting for `.next/dev/lock`.
  distDir,
  // Local desktop homes and distribution artifacts are never server assets.
  outputFileTracingExcludes: { '*': ['./.electron-demo/**', './release/**', './apps/**'] },
  async headers() {
    return [{
      source: '/notifications-sw.js',
      headers: [
        { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self'; connect-src 'self'" },
      ],
    }];
  },
  // StrictMode's dev-only double-fire of effects was causing real
  // user-facing bugs (rail mark-read triggered on the synthetic fake
  // unmount, before the user had seen the row). Effect cleanups here
  // are intentionally side-effectful — turning StrictMode off keeps
  // dev behavior aligned with prod.
  reactStrictMode: false,
  // Permit HMR / dev sockets when the user fronts the dev server with a
  // tunnel (ngrok, Tailscale magic DNS, Beamd, LAN IP, portless.sh) and
  // visits from a remote client. Without this, the WebSocket origin check
  // rejects the connection and HMR silently dies. Production builds
  // ignore this option.
  allowedDevOrigins: [
    "127.0.0.1",
    "[::1]",
    "*.beamd.run",
    "*.ngrok.io",
    "*.ngrok-free.app",
    "*.ts.net",
    "*.localhost",
  ],
};

export default nextConfig;
