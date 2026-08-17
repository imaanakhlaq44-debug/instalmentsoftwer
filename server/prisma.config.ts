import 'dotenv/config';
import path from 'node:path';
import { defineConfig } from 'prisma/config';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma 7 configuration.
 *
 * The connection URL lives here rather than in schema.prisma. The same adapter
 * is used by the CLI (migrate, studio) and by the runtime client, so there is
 * exactly one place that decides which database we talk to.
 *
 * Local development points at the PostgreSQL started by `npm run db:dev`;
 * production points at a managed server. Nothing else in the codebase changes
 * between them.
 */
export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  migrations: {
    path: path.join('prisma', 'migrations'),
  },

  // `prisma migrate` needs a plain URL in addition to the adapter, because it
  // opens its own shadow-database connection outside the client.
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },

  adapter: async () => {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        'DATABASE_URL is not set. Copy server/.env.example to server/.env, then start the local database with `npm run db:dev`.'
      );
    }
    return new PrismaPg({ connectionString });
  },
});
