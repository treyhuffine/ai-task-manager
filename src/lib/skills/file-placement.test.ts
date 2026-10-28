import { describe, expect, it } from 'vitest';
import { supportingPathFor } from './file-placement';

describe('supportingPathFor', () => {
  it('puts code in scripts/, docs in references/ and the rest in assets/', () => {
    expect(supportingPathFor('fetch_issues.py')).toBe('scripts/fetch_issues.py');
    expect(supportingPathFor('deploy.SH')).toBe('scripts/deploy.SH');
    expect(supportingPathFor('api-guide.md')).toBe('references/api-guide.md');
    expect(supportingPathFor('Style Guide.pdf')).toBe('references/Style Guide.pdf');
    expect(supportingPathFor('report-template.docx')).toBe('assets/report-template.docx');
    expect(supportingPathFor('logo.png')).toBe('assets/logo.png');
    expect(supportingPathFor('schema.json')).toBe('assets/schema.json');
  });

  it('keeps only the base name and treats a name without an extension as an asset', () => {
    expect(supportingPathFor('C:\\Users\\me\\run.ts')).toBe('scripts/run.ts');
    expect(supportingPathFor('/tmp/notes.txt')).toBe('references/notes.txt');
    expect(supportingPathFor('Makefile')).toBe('assets/Makefile');
  });
});
