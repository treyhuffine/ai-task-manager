import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
/** The browser UI kit may span files under src/ui. Each is emitted beside ui.js. */
const uiFiles = () => existsSync('src/ui') ? readdirSync('src/ui', { recursive: true }).filter(name => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)).map(name => `src/ui/${name}`) : [];
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--emitDeclarationOnly'], { stdio: 'inherit' });
await build({ entryPoints: [...['contract','sdk','runtime','build','testing','build-worker','service-build-worker','app-client','validation-worker','mcp-service','assets','templates','data','sources','time'].map(name => `src/${name}.ts`), 'src/ui.tsx', ...uiFiles()], outdir: 'dist', outbase: 'src', bundle: false, format: 'esm', platform: 'neutral', target: 'es2023', jsx: 'automatic', supported: { 'import-attributes': true } });
copyFileSync('src/owned-runner.cjs','dist/owned-runner.cjs');

// The view host lives in the workspace-only @ri/mcp-apps-host, which no registry
// serves. Apps install this SDK as a packed tarball outside the workspace, so the
// host is inlined here and every other import must be a dependency of this SDK.
// The MCP Apps bridge and its MCP SDK and zod 4 come with it, resolved from the
// host package (browser builds), like ext-apps' own with-deps bundles: this
// SDK's zod is 3.x, which the bridge does not support.
const HOST = '@ri/mcp-apps-host';
const INLINED = /^(@modelcontextprotocol\/|zod(\/|$))/;
const { dependencies } = JSON.parse(readFileSync('package.json', 'utf8'));
const packageName = specifier => specifier.split('/').slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
await build({ entryPoints: ['src/view-host.ts'], outdir: 'dist', bundle: true, format: 'esm', platform: 'neutral', target: 'es2023', conditions: ['browser'], mainFields: ['module', 'main'], plugins: [{ name: 'inline-view-host', setup(b) {
  b.onResolve({ filter: /^[^./]/ }, ({ path, importer }) => {
    // The host and its own subpaths (its CSP module) are inlined together.
    if (path === HOST || path.startsWith(`${HOST}/`)) return undefined;
    // The bridge's own dependency tree comes along with it.
    if (INLINED.test(path) || importer.includes('/node_modules/')) return undefined;
    if (dependencies[packageName(path)]) return { path, external: true };
    return { errors: [{ text: `${path} is not a dependency of @ri/app-kit, so the published view host could not load it` }] };
  });
} }] });
const ts = require('typescript');
const { options } = ts.convertCompilerOptionsFromJson({ ...JSON.parse(readFileSync('tsconfig.json', 'utf8')).compilerOptions, rootDir: undefined, outDir: undefined, emitDeclarationOnly: true }, '.');
const hostEntry = require.resolve(HOST);
const hostProgram = ts.createProgram([hostEntry], options);
const hostErrors = ts.getPreEmitDiagnostics(hostProgram);
if (hostErrors.length) throw new Error(ts.formatDiagnostics(hostErrors, { getCanonicalFileName: name => name, getCurrentDirectory: () => process.cwd(), getNewLine: () => '\n' }));
let hostTypes, cspTypes;
hostProgram.emit(hostProgram.getSourceFile(hostEntry), (_name, text) => { hostTypes = text; }, undefined, true);
hostProgram.emit(hostProgram.getSourceFile(require.resolve(`${HOST}/csp`)), (_name, text) => { cspTypes = text; }, undefined, true);
writeFileSync('dist/mcp-apps-host-csp.d.ts', cspTypes);
writeFileSync('dist/mcp-apps-host.d.ts', hostTypes.replaceAll(`"${HOST}/csp"`, '"./mcp-apps-host-csp.js"'));
writeFileSync('dist/view-host.d.ts', readFileSync('dist/view-host.d.ts', 'utf8').replaceAll(`"${HOST}"`, '"./mcp-apps-host.js"'));
for (const name of readdirSync('dist', { recursive: true }))
  if (/\.(c?js|d\.ts)$/.test(name) && /["']@ri\/mcp-apps-host["'/]/.test(readFileSync(`dist/${name}`, 'utf8')))
    throw new Error(`dist/${name} imports ${HOST}, which installs outside this workspace cannot resolve`);

const serverNames = ['contract','sdk','runtime','build','testing','mcp-service','assets','templates'];
await build({entryPoints:serverNames.map(name => `src/${name}.ts`),outdir:'dist',outExtension:{'.js':'.cjs'},bundle:false,format:'cjs',platform:'node',target:'node26',define:{'import.meta.url':'__riModuleUrl'}});
for (const name of serverNames) {
 const file = `dist/${name}.cjs`;
 const source=readFileSync(file,'utf8');
 const banner=source.includes('__riModuleUrl')?'const __riModuleUrl = require("node:url").pathToFileURL(__filename).href;\n':'';
 writeFileSync(file,banner+source.replace(/require\("\.\/(contract|sdk|runtime|build|testing|mcp-service|assets|templates)\.js"\)/g,'require("./$1.cjs")'));
}
