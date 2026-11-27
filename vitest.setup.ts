import "@testing-library/jest-dom/vitest";
import path from "node:path";

// Integration tests share the app's Prisma client; point it at an isolated
// PostgreSQL test database before any module under test is imported.
//
// The test database is provisioned from prisma/schema.prisma with
// `prisma db push` (the checked-in migrations target SQLite and are not
// Postgres-compatible). Set TEST_DATABASE_URL (or DATABASE_URL) to a
// PostgreSQL connection string for a throwaway database, e.g.
//   postgresql://user:password@localhost:5432/crm_test
if (process.env.VITEST === "true" && (process.env.TEST_DB ?? "1") === "1") {
  const { execSync } = await import("node:child_process");
  const testUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!testUrl || !testUrl.startsWith("postgresql://")) {
    throw new Error(
      "A PostgreSQL TEST_DATABASE_URL (or DATABASE_URL) is required to run " +
        'integration tests, e.g. "postgresql://user:password@localhost:5432/crm_test".',
    );
  }
  process.env.DATABASE_URL = testUrl;
  execSync("npx prisma db push --force-reset --skip-generate", {
    env: { ...process.env },
    stdio: "ignore",
    cwd: path.resolve(),
  });
}
