# PostgreSQL setup & migration

The CRM runs on **PostgreSQL** via Prisma 7 driver adapters
(`@prisma/adapter-pg`). This document covers provisioning PostgreSQL and
migrating an existing SQLite database.

## 1. Provision PostgreSQL

Any PostgreSQL 13+ server works. Quick local options:

```bash
# Option A: Docker
docker run --name crm-postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=crm \
  -p 5432:5432 -d postgres:16

# Option B: local server
createdb crm
```

## 2. Configure the connection

Copy `.env.example` to `.env` and set a PostgreSQL URL:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/crm"
```

`DATABASE_URL` is **required** — `prisma.config.ts` and `src/server/db.ts`
throw a clear error at startup if it is missing (there is no SQLite
fallback).

## 3. Apply the schema

```bash
npm run db:generate     # regenerate the Prisma client
npm run db:migrate      # create/apply migrations (prisma migrate dev)
npm run db:seed         # optional demo data (destructive)
```

For a throwaway/test database without migrations, `npx prisma db push`
syncs the schema directly.

## Driver adapter (Prisma 7)

Prisma 7 requires a driver adapter; there is no adapter-less
`new PrismaClient()` for a direct Postgres connection. `src/server/db.ts`
uses the official adapter:

```ts
import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
export const db = new PrismaClient({ adapter });
```

The adapter owns a `pg` connection pool, so the old dev-mode global
singleton was removed.

## Migrating from SQLite to PostgreSQL

The historical migrations under `prisma/migrations/` were generated for
SQLite and are **not** Postgres-compatible (SQLite-specific SQL such as
`DATETIME`/`AUTOINCREMENT`). To move an existing deployment:

1. **Dump the SQLite data** (per table) or re-seed from scratch:
   ```bash
   sqlite3 dev.db .dump > sqlite_dump.sql   # reference only
   ```
2. **Point `DATABASE_URL` at PostgreSQL** and regenerate a Postgres
   baseline. Either archive the old migrations and create a fresh one:
   ```bash
   mv prisma/migrations prisma/migrations_sqlite_archive
   npx prisma migrate dev --name init_postgres
   ```
   …or, for a greenfield database, bootstrap with `npx prisma db push`.
3. **Import the data** into the new Postgres schema (e.g. via `pgloader`,
   a CSV/`COPY` import, or the seed script for demo data).
4. Verify counts and spot-check money/date fields, then switch traffic.

> Note: `migration_lock.toml` still records the historical `sqlite`
> provider. Once you generate Postgres migrations (step 2) it is rewritten
> to `postgresql` automatically.

## Money fields

`Lead.estimatedValue` and `Deal.value` are currently `Float` (Postgres
`double precision`). `Float` is valid on PostgreSQL and is **not**
SQLite-specific, so the connection-path migration keeps it to avoid
changing the generated client types (`number`) and the JSON API contract.

A future change can promote these to `Decimal` (Postgres `numeric`) for
exact arithmetic; that is a separate, breaking change requiring updates to
every money calculation, formatter, and API serializer (Prisma exposes
`Decimal` objects, not `number`).
