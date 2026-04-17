import { defineConfig } from 'drizzle-kit';
import { getDbPath } from './src/lib/config/paths';

export default defineConfig({
  schema: './src/lib/db/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
  dbCredentials: {
    url: getDbPath(),
  },
});
