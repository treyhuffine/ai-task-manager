#!/usr/bin/env node
// Vendor brand logos for the integration catalog from `simple-icons` (CC0) into a
// committed TS data file, so the client bundle ships only the ~2 dozen paths we
// actually use (not the full 3,400-icon set) and works fully offline.
//
// This is codegen, not a postinstall step: `simple-icons` is a devDependency and
// the output is committed, so production installs (no devDeps) never need it.
// Re-run after adding a provider:  node scripts/gen-integration-icons.mjs
//
// Some major brands (Slack, Microsoft, Salesforce, …) were removed from
// simple-icons on the trademark holders' request. Those fall through to a
// brand-colored monogram tile defined in integration-meta.ts — see MISSING output.

import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const siRoot = resolve(repoRoot, 'node_modules/simple-icons');
const dest = resolve(repoRoot, 'src/components/integrations/integration-icon-data.ts');

// providerId -> ordered candidate simple-icons slugs/titles (first hit wins).
// Keep in sync with PROVIDER_CATALOG in packages/integrations/src/providers/index.ts.
const CANDIDATES = {
  onepassword: ['1password'],
  google: ['google'],
  slack: ['slack'],
  notion: ['notion'],
  microsoft: ['microsoft365', 'microsoft', 'microsoftoffice'],
  linear: ['linear'],
  jira: ['jira', 'jirasoftware'],
  discord: ['discord'],
  calendly: ['calendly'],
  raindrop: ['raindropdotio', 'raindrop'],
  zoom: ['zoom'],
  hubspot: ['hubspot'],
  salesforce: ['salesforce'],
  todoist: ['todoist'],
  airtable: ['airtable'],
  readwise: ['readwise'],
  stripe: ['stripe'],
  plaid: ['plaid'],
  telegram: ['telegram'],
  whatsapp: ['whatsapp'],
  gitlab: ['gitlab'],
  confluence: ['confluence'],
  asana: ['asana'],
  zendesk: ['zendesk'],
  dropbox: ['dropbox'],
  box: ['box'],
  quickbooks: ['quickbooks', 'intuit'],
  resend: ['resend'],
  mailgun: ['mailgun'],
  twitter: ['x', 'twitter'],
  // Not a provider: Gmail is a toolkit of `google`, drawn on its own in the
  // rail's "Connect apps" stack, where the app people recognize is Gmail.
  gmail: ['gmail'],
};

// Brands simple-icons doesn't carry, vendored from the brand's own published
// artwork. Each is one 24x24 path, like simple-icons, with its source recorded.
const VENDORED = {
  // Traced from assets/magicpath.png in https://github.com/MagicPathAI/magicpath-agent-plugin
  // (MIT, commit 3afaaa5), fitted to the 24x24 box. Brand color from its plugin manifest.
  magicpath: {
    title: 'MagicPath',
    hex: '085C34',
    path: 'M8.734 3.004C7.959 3.104 7.106 3.282 6.676 3.434C4.214 4.299 2.169 6.456 1.028 9.395C0.789 10.008 0.557 10.762 0.472 11.196C0.438 11.369 0.374 11.664 0.33 11.853C0.123 12.747 0 14.856 0.076 16.196C0.135 17.245 0.289 18.901 0.333 18.971C0.348 18.993 0.395 19.256 0.439 19.554C0.484 19.853 0.566 20.182 0.619 20.288C0.941 20.91 1.861 21.048 2.402 20.554C2.472 20.491 2.572 20.31 2.623 20.153C2.731 19.829 2.728 19.77 2.497 18.112C2.359 17.117 2.342 16.816 2.339 15.311C2.334 13.802 2.347 13.541 2.467 12.825C2.876 10.351 3.685 8.574 5.033 7.184C5.882 6.31 6.589 5.849 7.578 5.528C8.301 5.294 8.795 5.232 9.619 5.27C10.413 5.305 11.203 5.504 11.791 5.815C12.507 6.192 12.622 6.266 13.013 6.6C13.702 7.192 14.297 8.063 14.534 8.834C14.598 9.043 14.644 9.217 14.636 9.222C14.627 9.227 14.415 9.291 14.164 9.366C12.479 9.867 11.069 10.722 9.729 12.053C8.223 13.549 7.448 15.023 7.448 16.385C7.448 17.8 8.457 19.057 9.819 19.341C11.198 19.627 12.488 19.186 13.899 17.942C14.942 17.024 15.79 15.777 16.411 14.254C16.697 13.547 16.935 12.577 17.078 11.523L17.114 11.25L17.325 11.284C17.79 11.359 17.894 11.382 18.279 11.495C18.762 11.636 19.293 11.876 19.696 12.135C20.581 12.705 21.105 13.544 21.461 14.96C21.641 15.668 21.643 15.707 21.642 16.997C21.641 18.04 21.62 18.4 21.541 18.74C21.313 19.724 21.336 20.107 21.643 20.491C21.916 20.83 22.41 20.949 22.886 20.79C23.387 20.622 23.573 20.248 23.782 18.997C23.99 17.747 24 16.16 23.806 15.084C23.145 11.432 20.966 9.421 17.207 8.995C16.938 8.964 16.878 8.939 16.878 8.851C16.878 8.645 16.489 7.56 16.254 7.109C15.863 6.362 15.512 5.886 14.906 5.278C13.694 4.064 12.22 3.353 10.355 3.085C9.573 2.973 9.144 2.952 8.734 3.004ZM14.449 11.645C14.606 11.588 14.751 11.541 14.771 11.541C14.79 11.54 14.773 11.712 14.733 11.924C14.423 13.533 13.739 14.876 12.67 15.971C12.186 16.467 11.685 16.835 11.18 17.067C10.915 17.188 10.807 17.206 10.525 17.182C9.885 17.123 9.616 16.75 9.736 16.093C9.873 15.357 10.308 14.683 11.278 13.704C12.271 12.698 13.204 12.093 14.449 11.645Z',
  },
};

function extractPath(svg) {
  // simple-icons ship exactly one <path d="…"/>.
  const m = svg.match(/\sd="([^"]+)"/);
  return m ? m[1] : null;
}

async function main() {
  const arr = JSON.parse(await readFile(resolve(siRoot, 'data/simple-icons.json'), 'utf8'));
  const bySlug = new Map(arr.map((i) => [i.slug, i]));
  const byTitle = new Map(arr.map((i) => [i.title.toLowerCase(), i]));

  const found = {};
  const missing = [];

  for (const [providerId, cands] of Object.entries(CANDIDATES)) {
    let hit = null;
    for (const c of cands) {
      const entry = bySlug.get(c) || byTitle.get(c.toLowerCase());
      const svgPath = entry && resolve(siRoot, `icons/${entry.slug}.svg`);
      if (entry && svgPath && existsSync(svgPath)) {
        const d = extractPath(await readFile(svgPath, 'utf8'));
        if (d) {
          hit = { title: entry.title, hex: entry.hex, path: d };
          break;
        }
      }
    }
    if (hit) found[providerId] = hit;
    else missing.push(providerId);
  }
  for (const [providerId, icon] of Object.entries(VENDORED)) found[providerId] = icon;

  const version = JSON.parse(await readFile(resolve(siRoot, 'package.json'), 'utf8')).version;
  const entries = Object.entries(found)
    .map(
      ([id, v]) =>
        `  ${id}: { title: ${JSON.stringify(v.title)}, hex: ${JSON.stringify(v.hex)}, path: ${JSON.stringify(v.path)} },`,
    )
    .join('\n');

  const out = `// GENERATED by scripts/gen-integration-icons.mjs — do not edit by hand.
// Source: simple-icons@${version} (CC0-1.0), plus brand artwork vendored in the script. Re-run: node scripts/gen-integration-icons.mjs
//
// Brand glyph path data for integration logos, keyed by providerId. Each is a single
// 24x24 path (the simple-icons convention). Providers absent here render a
// brand-colored monogram fallback (see integration-meta.ts brandHex).

export interface IntegrationIconDatum {
  /** Brand display title, e.g. "Notion". */
  title: string;
  /** Brand color as a 6-digit hex (no leading #). */
  hex: string;
  /** SVG path \`d\` for a 0 0 24 24 viewBox. */
  path: string;
}

export const INTEGRATION_ICONS: Record<string, IntegrationIconDatum> = {
${entries}
};
`;

  await writeFile(dest, out, 'utf8');
  console.log(`[integration-icons] wrote ${Object.keys(found).length} logos → ${dest.replace(repoRoot + '/', '')}`);
  console.log(`[integration-icons] MISSING (monogram fallback): ${missing.join(', ') || '(none)'}`);
}

main().catch((err) => {
  console.error(`[integration-icons] failed: ${err.message}`);
  process.exit(1);
});
