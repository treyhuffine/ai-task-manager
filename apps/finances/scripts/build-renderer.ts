import {build} from 'esbuild';
import fs from 'node:fs/promises';
await fs.mkdir('public',{recursive:true});
await build({stdin:{contents:"export {App} from '@modelcontextprotocol/ext-apps';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'iife',globalName:'FinanceMcpSdk',platform:'browser',target:'es2022',minify:true,outfile:'public/renderer-sdk.js',legalComments:'inline'});
await build({entryPoints:['src/components/workspace/entry.tsx'],bundle:true,format:'iife',platform:'browser',target:'es2022',minify:true,outfile:'public/finance-workspace.js',define:{'process.env.NODE_ENV':'"production"'},legalComments:'inline'});
