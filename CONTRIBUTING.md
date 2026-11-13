# Contributing to nextjs-crm

Thank you for your interest in contributing! This is a community-driven
open-source project, and contributions of all kinds are welcome — bug
reports, code, docs, design ideas, and feature discussions.

## Ways to contribute

- 🐛 [Report a bug](https://github.com/sana-ullah305/nextjs-crm/issues/new?template=bug_report.md)
- 💡 [Suggest a feature](https://github.com/sana-ullah305/nextjs-crm/issues/new?template=feature_request.md)
- 📝 Improve documentation
- 🔧 Submit a pull request

## Getting started

1. Fork the repository and clone your fork.
2. Install Node.js 22+ and npm.
3. Install dependencies and set up the local environment:

   ```bash
   npm install
   cp .env.example .env
   npm run db:migrate
   npm run db:seed
   npm run dev
   ```

4. Create a branch for your change:

   ```bash
   git checkout -b feat/my-feature
   ```

## Development workflow

All changes go through pull requests:

1. Make your changes on a feature branch.
2. Make sure the following all pass locally:

   ```bash
   npm run typecheck   # TypeScript strict check
   npm run lint        # ESLint
   npm test            # Vitest suite (real database, no mocks)
   ```

3. Push your branch and open a pull request against `main`.
4. Wait for CI to pass and address review feedback.

## Code guidelines

- **TypeScript strict mode** — the project builds with strict settings; do
  not weaken types to make an error disappear.
- **Validation** — every API endpoint is validated with Zod schemas in
  `src/lib/schemas/`. New endpoints need schemas and tests.
- **Access control** — every query must be org-scoped and respect the RBAC
  matrix in `src/server/rbac.ts`. Security-sensitive changes need tests
  proving enforcement.
- **Tests** — run against a real, isolated SQLite database. Add tests for
  new features and bug fixes (regression tests for bugs are required).
- **No enums in Prisma** — the schema uses string fields + Zod validation to
  stay PostgreSQL-compatible. Same for arrays: use join tables.
- **Commit style** — use
  [Conventional Commits](https://www.conventionalcommits.org/)
  (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`).
- Keep PRs focused: one logical change per pull request.

## Committing database schema changes

The schema lives in `prisma/schema.prisma`. If you change it:

1. Update `prisma/schema.prisma`.
2. Generate a migration with `npm run db:migrate` and commit the generated
   SQL under `prisma/migrations/`.
3. Update `docs/database-schema.md` if models change.

## Project structure

See [docs/architecture.md](docs/architecture.md) and the README's project
structure section for a tour of the codebase.

## Reporting security issues

Please do **not** open public issues for security vulnerabilities. See
[SECURITY.md](SECURITY.md) for how to report them responsibly.

## Questions and discussions

Open a [GitHub Discussion](https://github.com/sana-ullah305/nextjs-crm/discussions)
or an issue with the question label — happy to help.

## Sponsor

If nextjs-crm saves you time, consider
[becoming a sponsor](https://github.com/sana-ullah305) — it keeps
development sustainable. ❤️
