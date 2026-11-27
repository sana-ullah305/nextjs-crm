import "dotenv/config";
import path from "node:path";
import type { PrismaConfig } from "prisma";

// PostgreSQL is required. Fail fast (with a clear message) if DATABASE_URL is
// missing instead of silently falling back to a local SQLite file.
const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL is required. Set it to a PostgreSQL connection string, " +
      'e.g. "postgresql://user:password@localhost:5432/crm".',
  );
}

const config: PrismaConfig = {
  schema: path.join("prisma", "schema.prisma"),
  datasource: {
    url,
  },
};

export default config;
