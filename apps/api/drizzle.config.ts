import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  casing: 'snake_case',
  dbCredentials: {
    url:
      process.env.DATABASE_URL_MIGRATIONS ??
      'postgres://wcrm_owner:change-me-owner@localhost:5432/wcrm',
  },
});
