import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { teamRoleDecisions } from '@/test/team-role-decisions';

it('keeps role decisions in the team capability table, following aliases and destructuring', () => {
  const configFile = ts.readConfigFile('tsconfig.json', ts.sys.readFile);
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, process.cwd());
  const files = config.fileNames.filter(file => /\/src\//.test(file) && !/\.(test|browser)\./.test(file) && !file.includes('/src/test/'));
  const program = ts.createProgram(files, { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();
  const problems = files.filter(file => !file.endsWith('/team/capabilities.ts')).flatMap(file => {
    const source = program.getSourceFile(file)!;
    // Avoid type resolution for files with no role policy data.
    if (!/owner|member/.test(fs.readFileSync(file, 'utf8'))) return [];
    return teamRoleDecisions(source, checker).map(line => `${path.relative(process.cwd(), file)}:${line}`);
  });
  expect(problems).toEqual([]);
}, 30_000);

it.each([
  "m.role === 'owner'", "m['role'] === 'owner'", "['owner'].includes(m.role)",
  "(() => { const {role: access} = m; return access === 'owner'; })()",
  "(() => { const access = m.role; const admin = 'owner'; return access === admin; })()",
  "(() => { switch(m.role) {case 'owner': return true; default: return false;} })()",
  "new Set(['owner']).has(m.role)", "({owner:true,member:false})[m.role]", "'owner' === m.role",
])('detects role policy expressed as %s', expression => {
  const file = '/policy.ts';
  const source = ts.createSourceFile(file, `declare const m: { role: 'owner' | 'member' }; const allowed = ${expression};`, ts.ScriptTarget.Latest, true);
  const host = ts.createCompilerHost({ noLib: true });
  host.getSourceFile = name => name === file ? source : undefined;
  const program = ts.createProgram([file], { noLib: true }, host);
  expect(teamRoleDecisions(source, program.getTypeChecker()).length).toBeGreaterThan(0);
});
