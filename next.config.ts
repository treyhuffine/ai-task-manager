import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "sqlite-vec"],
  // Honor NEXT_DIST_DIR so the smoke-test server can boot alongside a
  // running `pnpm dev` without fighting for `.next/dev/lock`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
