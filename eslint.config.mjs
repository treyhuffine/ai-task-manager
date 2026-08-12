import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Keep `node:crypto` out of the client bundle.
    //
    // `src/lib/auth/tokens.ts` imports `node:crypto` at module scope, so any
    // component importing from it pulls in the crypto-browserify polyfill —
    // ~457KB, landing in the main shell chunk that every route blocks on.
    // The only thing the UI ever wanted was `tokenDisplay`, a pure string
    // formatter, which now lives in the crypto-free `token-display`.
    //
    // Worth a lint rule because the mistake is invisible in review: the two
    // imports are one word apart and both typecheck.
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": ["error", {
        paths: [{
          name: "@/lib/auth/tokens",
          message:
            "Pulls node:crypto (~457KB) into the client bundle. Import tokenDisplay from '@/lib/auth/token-display' instead; hashing and generation are server-only.",
        }],
      }],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
