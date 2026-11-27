import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

// Prisma 7 requires a driver adapter. For PostgreSQL we use the official
// `@prisma/adapter-pg` adapter (node-postgres under the hood). Its internal
// connection pool is shared for the lifetime of this module instance, so the
// dev-mode global singleton is no longer needed.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is required. Set it to a PostgreSQL connection string, " +
      'e.g. "postgresql://user:password@localhost:5432/crm".',
  );
}

const adapter = new PrismaPg({ connectionString });

export const db = new PrismaClient({
  adapter,
  log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
});

export default db;
