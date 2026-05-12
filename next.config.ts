import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sqlite-vec", "node-pty"],
  // Honor NEXT_DIST_DIR so the smoke-test server can boot alongside a
  // running `pnpm dev` without fighting for `.next/dev/lock`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // StrictMode's dev-only double-fire of effects was causing real
  // user-facing bugs (rail mark-read triggered on the synthetic fake
  // unmount, before the user had seen the row). Effect cleanups here
  // are intentionally side-effectful — turning StrictMode off keeps
  // dev behavior aligned with prod.
  reactStrictMode: false,
};

export default nextConfig;
