import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { copyFileSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
/** The browser UI kit may span files under src/ui. Each is emitted beside ui.js. */
const uiFiles = () => existsSync('src/ui') ? readdirSync('src/ui', { recursive: true }).filter(name => /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)).map(name => `src/ui/${name}`) : [];
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--emitDeclarationOnly'], { stdio: 'inherit' });
await build({ entryPoints: [...['contract','sdk','runtime','view-host','build','testing','build-worker','service-build-worker','app-client','validation-worker','mcp-service','assets','templates','data','sources','time'].map(name => `src/${name}.ts`), 'src/ui.tsx', ...uiFiles()], outdir: 'dist', outbase: 'src', bundle: false, format: 'esm', platform: 'neutral', target: 'es2023', jsx: 'automatic', supported: { 'import-attributes': true } });
copyFileSync('src/owned-runner.cjs','dist/owned-runner.cjs');

const serverNames = ['contract','sdk','runtime','build','testing','mcp-service','assets','templates'];
await build({entryPoints:serverNames.map(name => `src/${name}.ts`),outdir:'dist',outExtension:{'.js':'.cjs'},bundle:false,format:'cjs',platform:'node',target:'node26',define:{'import.meta.url':'__riModuleUrl'}});
for (const name of serverNames) {
 const file = `dist/${name}.cjs`;
 const source=readFileSync(file,'utf8');
 const banner=source.includes('__riModuleUrl')?'const __riModuleUrl = require("node:url").pathToFileURL(__filename).href;\n':'';
 writeFileSync(file,banner+source.replace(/require\("\.\/(contract|sdk|runtime|build|testing|mcp-service|assets|templates)\.js"\)/g,'require("./$1.cjs")'));
}
