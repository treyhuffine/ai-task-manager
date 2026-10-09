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
  {
    // Tooltips go through <Tip> (`src/components/ui/tip.tsx`). The browser's
    // `title` tooltip ignores the app's styling and delay, never shows on
    // keyboard focus, and doubles up with a Tip on the same element.
    // `iframe` keeps `title`: there it names the frame, it isn't a tooltip.
    // The second selector covers components that pass `title` to the DOM.
    files: ["src/**/*.tsx"],
    rules: {
      "no-restricted-syntax": ["error", {
        selector: "JSXOpeningElement[name.name=/^[a-z]/][name.name!='iframe'] > JSXAttribute[name.name='title']",
        message: "Use <Tip label=\"…\"> from '@/components/ui/tip' instead of the title attribute.",
      }, {
        selector: "JSXOpeningElement:matches([name.name=/^(Button|Link|NodeViewWrapper|\\w+Trigger)$/], [name.type='JSXMemberExpression']) > JSXAttribute[name.name='title']",
        message: "This component passes title to the DOM. Wrap it in <Tip label=\"…\"> from '@/components/ui/tip' instead.",
      }],
    },
  },
  {
    // Shared operations all receive input and request metadata. A leading
    // underscore marks the pieces that this particular operation does not need.
    files: ["src/lib/server/operations/**/*.ts"],
    rules: { "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }] },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output of `pnpm smoke:*` (NEXT_DIST_DIR), gitignored like .next.
    ".next-smoke/**",
    // Desktop builds, disposable homes and packaged apps are generated artifacts.
    ".next-desktop/**",
    ".next-desktop-dev/**",
    ".electron-demo/**",
    "release/**",
    // Gitignored local material that is not this app's source: reference
    // clones, contributor scratch, and the CLI bundle.
    "examples/**",
    ".reference/**",
    "personal/**",
    "dist/**",
    "packages/*/dist/**",
    // Each app owns its framework config and lint rules.
    "apps/**",
  ]),
]);

export default eslintConfig;
