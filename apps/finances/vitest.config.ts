import { defineConfig } from 'vitest/config';
import path from 'node:path';
export default defineConfig({resolve:{alias:{'@':path.resolve('src')}},test:{include:['src/**/*.test.ts'],fileParallelism:false,exclude:['**/node_modules/**','**/.next/**','**/release/**','**/finance.browser.test.ts'],testTimeout:30000}});
