import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `@beamd/cli` is a binary launcher — Flow resolves its native per-platform
  // binary via `require.resolve` and execs it. It must stay external so the
  // production build doesn't bundle/rewrite that resolution (which breaks the
  // launch in `next start`). Same rationale as the native deps below.
  serverExternalPackages: ["better-sqlite3", "sqlite-vec", "node-pty", "@beamd/cli"],
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
