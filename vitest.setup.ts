import "@testing-library/jest-dom/vitest";

// Integration tests share the app's Prisma client; point it at an isolated
// test database before any module under test is imported.
if (process.env.VITEST === "true" && (process.env.TEST_DB ?? "1") === "1") {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { execSync } = await import("node:child_process");
  const TEST_DB_PATH = path.resolve("prisma/test.db");
  if (fs.existsSync(TEST_DB_PATH)) fs.rmSync(TEST_DB_PATH);
  process.env.DATABASE_URL = `file:${TEST_DB_PATH}`;
  execSync("npx prisma migrate deploy", {
    env: { ...process.env },
    stdio: "ignore",
    cwd: path.resolve(),
  });
}
