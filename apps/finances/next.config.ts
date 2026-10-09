import type { NextConfig } from 'next';
const config:NextConfig={output:'standalone',outputFileTracingRoot:process.cwd(),serverExternalPackages:['better-sqlite3'],turbopack:{root:process.cwd()},outputFileTracingExcludes:{'*':['./release/**','./.git/**','./.env*']}};
export default config;
