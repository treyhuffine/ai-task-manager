/** Real browser rendering (Playwright Chromium transport, executable recorded by the caller) with explicit synthetic data adapters. Never a production browser. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build, type Plugin } from 'esbuild';
import { chromium } from 'playwright-core';
export async function browserFixture(contents: string, plugins: Plugin[] = [], options: { css?: boolean } = {}) {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: 'tsx', contents }, bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env': '{"NODE_ENV":"development"}' }, loader: { '.css': 'empty' }, plugins });
  let css = '';
  if (options.css) {
    const require = createRequire(import.meta.url);
    const postcss = createRequire(require.resolve('@tailwindcss/postcss'))('postcss');
    const file = path.resolve('src/app/globals.css');
    css = (await postcss([require('@tailwindcss/postcss')({ base: process.cwd() })]).process(fs.readFileSync(file, 'utf8'), { from: file })).css;
  }
  const server = http.createServer((req, res) => {
    res.setHeader('content-type', req.url === '/bundle.js' ? 'text/javascript' : req.url === '/style.css' ? 'text/css' : 'text/html');
    res.end(req.url === '/bundle.js' ? bundle.outputFiles[0].text : req.url === '/style.css' ? css : '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const browser = await chromium.launch({ headless: true, executablePath: process.env.RI_REVIEW_CHROMIUM });
  return { url, browser, async close() { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
