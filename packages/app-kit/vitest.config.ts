import { defineConfig } from 'vitest/config';
export default defineConfig({esbuild:{jsx:'automatic'},test:{include:['test/**/*.test.ts','test/**/*.test.tsx'],testTimeout:20000,hookTimeout:20000,maxWorkers:2}});
