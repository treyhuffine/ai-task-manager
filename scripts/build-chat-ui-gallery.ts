import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import tailwind from '@tailwindcss/postcss';
import { prepareResource } from '../src/lib/mcp-apps/resource';
import { GALLERY_GUEST_HTML } from '@/components/chat-ui/gallery/guest';
import { CHAT_UI_EXAMPLES } from '@/components/chat-ui/gallery/catalog';

/** Generated at install/build/dev startup. The regular application never installs a mock client. */
export async function buildChatUiGallery() {
  const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outputDir = path.join(repo, 'public/chat-ui-gallery');
  const fixtureClient = path.join(repo, 'src/components/chat-ui/gallery/fixture-client.ts');
  const resource = prepareResource({ contents: [{ uri: 'ui://gallery/estimate.html', mimeType: 'text/html;profile=mcp-app', text: GALLERY_GUEST_HTML }] }, 'ui://gallery/estimate.html', false);
  const require = createRequire(import.meta.url);
  const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
  const sourceCss = (await fs.readFile(path.join(repo, 'src/app/globals.css'), 'utf8')).replace(/@import ['"]tailwindcss['"];/, '@import "tailwindcss" source(none);\n@source "../components";');
  const { css } = await postcss([tailwind()]).process(sourceCss, { from: path.join(repo, 'src/app/globals.css') });
  await fs.mkdir(outputDir, { recursive: true });
  const files: { name: string; bytes: number }[] = [];
  for (const example of CHAT_UI_EXAMPLES) {
    const bundle = await build({
      absWorkingDir: repo, entryPoints: ['src/components/chat-ui/gallery/preview.tsx'], bundle: true, write: false, minify: true,
      platform: 'browser', format: 'iife', jsx: 'automatic', tsconfig: 'tsconfig.json',
      define: { 'process.env': '{"NODE_ENV":"production"}', __GALLERY_MCP_RESOURCE__: JSON.stringify(resource), __GALLERY_EXAMPLE__: JSON.stringify(example.id) },
      plugins: [{ name: 'isolated-gallery', setup(builder) {
        builder.onResolve({ filter: /^@\/lib\/trpc\/client$/ }, () => ({ path: fixtureClient }));
        builder.onResolve({ filter: /^@\/lib\/folders\/source$/ }, () => ({ path: path.join(repo, 'src/components/chat-ui/gallery/folder-source.ts') }));
        // Only the selected example is compiled into each standalone document.
        // The gallery has no reason to initialize unrelated component modules.
        builder.onResolve({ filter: /^@\/components\// }, args => {
          const base = path.join(repo, 'src', args.path.slice(2));
          const file = [base, `${base}.tsx`, `${base}.ts`, path.join(base, 'index.tsx')].find(file => existsSync(file));
          return file ? { path: file, sideEffects: false } : undefined;
        });
        builder.onResolve({ filter: /^next\/(navigation|link)$/ }, args => ({ path: args.path, namespace: 'gallery-framework' }));
        builder.onLoad({ filter: /.*/, namespace: 'gallery-framework' }, args => ({ contents: args.path === 'next/link'
          ? 'import {createElement} from "react";export default function Link({prefetch,replace,scroll,...props}){return createElement("a",props)}'
          : 'export const useRouter=()=>({push(){},replace(){},refresh(){}});export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>"/gallery";', loader: 'js', resolveDir: repo }));
      } }],
    });
    const script = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
    const csp = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; frame-src 'self' about: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'";
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><title>Chat UI gallery example</title><style>${css}</style><style>body{margin:0;font-family:Inter,system-ui,sans-serif;background:var(--background);color:var(--foreground)}#root{min-width:0}img{max-width:100%}</style></head><body><main id="root"></main><script>${script}</script></body></html>`;
    await fs.writeFile(path.join(outputDir, `${example.id}.html`), html);
    files.push({ name: example.id, bytes: Buffer.byteLength(html) });
  }
  return { directory: outputDir, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  buildChatUiGallery().then(result => console.log(`Chat UI gallery built: ${result.files.map(file => `${file.name} ${Math.round(file.bytes / 1024)} KiB`).join(', ')}`)).catch(error => { console.error(error); process.exitCode = 1; });
}
