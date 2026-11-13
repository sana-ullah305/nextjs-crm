# Security Policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| main    | ✅        |

Security fixes are applied to `main`; there are no backport releases yet.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub
issues.**

Instead, report them privately using either:

1. **GitHub private vulnerability reporting** — go to the
   [Security tab](https://github.com/sana-ullah305/nextjs-crm/security)
   and click "Report a vulnerability". (Preferred — see MANAGEMENT.md below
   if the tab is not yet enabled.)
2. Email **sanaullah305.sec@gmail.com** with a description, reproduction
   steps, and impact assessment.

You should receive an acknowledgment within 72 hours. Please give us a
reasonable amount of time to fix the issue before public disclosure
(90 days is a good default).

### What to include

- Type of issue (XSS, CSRF, auth bypass, injection, etc.)
- Full paths of source files related to the vulnerability
- Step-by-step reproduction instructions or a proof of concept
- Affected URLs, routes, or API endpoints
- Potential impact, including how an attacker might exploit it

## Scope

The application code in this repository is in scope. The following are out
of scope:

- Third-party services and dependencies (report upstream)
- Demo accounts and seeded demo data (`npm run db:seed` is for local
  development only)
- Deployed instances not operated by the maintainers
- Denial of service, volumetric attacks, and automated scanning

## Known security posture

See [docs/security.md](docs/security.md) for the project's implemented
security controls (bcrypt password hashing, HttpOnly session cookies with
hashed tokens, login rate limiting, Zod validation on endpoints,
org-scoped queries, record-level ownership rules, audit trail, and
security headers).

## Preferred languages

English is preferred for reports.
