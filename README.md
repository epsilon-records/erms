# ERMS — Epsilon Records Management System

The label's system of record: catalog, rights, releases, distribution and royalties.
Audio processing is delegated to [AudioKit](https://github.com/epsilon-records/audiokit) through a versioned `AudioProvider` contract.

## Stack

SvelteKit 3 (Svelte 5 runes) · TypeScript · PostgreSQL 17 on Supabase · Drizzle ORM · Zod · Supabase Auth (magic link) · pg-boss · Railway (web + worker) · Vitest + PGlite.

## Layout

```
src/
  env.ts                    validated env vars ($app/env/public, $app/env/private)
  hooks.server.ts           Supabase session + org membership on every request
  routes/                   ASCII UI: /login, /auth/callback, /logout, /
  lib/server/
    db/                     schema, migrations source, UUIDv7
    audit.ts                withAudit(): change + audit entry in one transaction
    rbac.ts                 roles and scopes
    queue.ts                pg-boss queues
    audio/                  contract v1 (Zod), AudioProvider, stub, webhook HMAC
  worker/                   background worker (separate Railway service)
drizzle/                    SQL migrations (0001 adds RLS + append-only audit log)
```

## Development

```bash
pnpm install
cp .env.example .env        # fill in Supabase URL and publishable key
docker compose up -d        # local Postgres 17 + MinIO
pnpm db:migrate
pnpm dev                    # web
pnpm worker                 # background worker
pnpm test                   # unit + database tests (PGlite, no Docker needed)
```

## Rules

- Every write goes through `withAudit()`. A write with no audit entry is rejected.
- `audit_log` is append-only, enforced by a database trigger.
- Every org-scoped table gets RLS with `app.is_member(org_id)`; see `drizzle/0001_rls.sql`.
- No secrets in the repo. Railway holds production env vars.

## Roadmap

Phase 0 foundation → 1 catalog core → 3 rights → 4 AudioKit integration → 5 metadata intelligence → 6 distribution and royalties → 7 consent-gated AI and agents. (Phase 2, the universe artist graph, lives in AudioKit.)
