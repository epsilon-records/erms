# ERMS — Epsilon Records Management System

The label's system of record: catalog, rights, releases, distribution and royalties.
Audio processing is delegated to [AudioKit](https://github.com/epsilon-records/audiokit) through a versioned `AudioProvider` contract.

## Stack

SvelteKit 3 (Svelte 5 runes) · TypeScript · Drizzle ORM · Zod · Vitest + PGlite.

| Concern                         | Where it runs                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------- |
| Web UI + REST API               | Netlify (`@sveltejs/adapter-netlify`)                                             |
| Database (PostgreSQL 17)        | Supabase project "ERMS" (efalpthvvmvpaikuxymd, eu-central-1, org Epsilon Records) |
| Auth (magic link)               | Supabase Auth                                                                     |
| File storage (masters, artwork) | Supabase Storage                                                                  |
| Background processing (Phase 3) | Supabase Queues + Cron + an Edge Function                                         |

## Layout

```
src/
  env.ts                    validated env vars ($app/env/public, $app/env/private)
  hooks.server.ts           Supabase session, active org and RLS-scoped db on every request
  routes/                   ASCII UI: /login, /auth/callback, /logout, /
  lib/server/
    db/                     schema, migrations source, UUIDv7
    audit.ts                withAudit(): change + audit entry in one transaction
    rbac.ts                 roles and scopes
    audio/                  contract v1 (Zod), AudioProvider, stub, webhook HMAC
drizzle/                    SQL migrations (RLS, append-only audit log, same-org keys, app role)
```

## Development

```bash
pnpm install
cp .env.example .env        # fill in Supabase URL and publishable key
docker compose up -d        # local Postgres 17
pnpm db:migrate
pnpm dev
pnpm test                   # unit + database tests (PGlite, no Docker needed)
```

## Rules

- Every write goes through `withAudit()`. A write with no audit entry is rejected.
- `audit_log` is append-only, enforced by a database trigger.
- Every org-scoped table gets RLS with `app.is_member(org_id)` for reads and role-based write policies; see `drizzle/0001_rls.sql`, `0004` and `0006`.
- App queries never run as the table owner. Routes use `locals.db`, which runs each call in a transaction as the `erms_app` role on behalf of the signed-in user, so RLS checks every read and write (`src/lib/server/db/scoped.ts`). A test fails if any other file imports the owner connection.
- Links between catalog rows carry `org_id` in their foreign keys, so the database refuses links across orgs.
- `src/lib/server/tenancy.test.ts` proves one org cannot read, write or link into another.
- Security headers: SvelteKit sets a nonce-based CSP (`vite.config.ts`); `hooks.server.ts` and `netlify.toml` add HSTS, frame, referrer and permissions headers. Unexpected errors are logged server-side as JSON with a short reference; the browser sees only the reference.
- CI also runs `pnpm audit` and a gitleaks scan of the full history; CodeQL and Dependabot run separately.
- No secrets in the repo. Netlify and Supabase hold production env vars and secrets.
- In production `DATABASE_URL` points at Supabase's transaction pooler (port 6543); the client already disables prepared statements for it.

## Roadmap

Phase 0 foundation → 1 catalog core → 2 rights and contracts → 3 AudioKit integration → 4 metadata intelligence → 5 distribution and royalties → 6 consent-gated AI and agents.

Music intelligence (an artist graph from open music data) is out of scope for now and will be planned separately in AudioKit.
