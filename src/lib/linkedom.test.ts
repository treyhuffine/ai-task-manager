/**
 * Server code loads linkedom only through `./linkedom`, with require(). An
 * import of it anywhere else puts linkedom's ESM build beside the CommonJS one
 * @ri/app-kit's server build requires, and the build or a request fails at
 * random with ERR_REQUIRE_ESM_RACE_CONDITION (see `./linkedom.ts`).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseHTML } from './linkedom';

const ROOT = path.resolve(__dirname, '../..');
const SOURCES = ['src', 'instrumentation.ts'];
const LOADER = 'src/lib/linkedom.ts';
/** A static import or re-export (type-only ones are erased) or a dynamic import(). */
const IMPORT = /(?:^|\n)\s*(?:import|export)(?!\s+type\b)[^;]*?\bfrom\s*['"]linkedom(?:\/[^'"]*)?['"]|(?<!typeof\s*)\bimport\s*\(\s*['"]linkedom(?:\/[^'"]*)?['"]/;

function sourceFiles(entry: string): string[] {
  const full = path.join(ROOT, entry);
  if (!fs.statSync(full).isDirectory()) return [entry];
  return fs.readdirSync(full, { recursive: true, encoding: 'utf8' })
    .filter(name => /\.(ts|tsx|mts|cts)$/.test(name) && !/\.test\.tsx?$/.test(name))
    .map(name => path.join(entry, name));
}

describe('linkedom loading', () => {
  it('has no import of linkedom in server code outside the loader', () => {
    const importers = SOURCES.flatMap(sourceFiles)
      .filter(file => file !== LOADER && IMPORT.test(fs.readFileSync(path.join(ROOT, file), 'utf8')));
    expect(importers).toEqual([]);
  });

  it('recognizes the imports that would bring the ESM build back', () => {
    expect(IMPORT.test(`import { parseHTML } from 'linkedom';`)).toBe(true);
    expect(IMPORT.test(`import {\n  DOMParser,\n} from "linkedom/cached";`)).toBe(true);
    expect(IMPORT.test(`export { parseHTML } from 'linkedom';`)).toBe(true);
    expect(IMPORT.test(`const { parseHTML } = await import('linkedom');`)).toBe(true);
    expect(IMPORT.test(`import type { parseHTML } from 'linkedom';`)).toBe(false);
    expect(IMPORT.test(`type Linkedom = typeof import('linkedom');`)).toBe(false);
  });

  it('parses and queries a document through the CommonJS build', () => {
    const { document } = parseHTML('<main><p class="lead">Hello</p><p>World</p></main>');
    expect(document.querySelector('main > p.lead')?.textContent).toBe('Hello');
    expect(document.querySelectorAll('p:not(.lead)')).toHaveLength(1);
  });
});
