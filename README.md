# ERMS — Epsilon Records Management System

The label's system of record: catalog, rights, releases, distribution and royalties.
Audio processing is delegated to [AudioKit](https://github.com/epsilon-records/audiokit) through an `AudioProvider` interface that speaks AudioKit's OpenAPI contract. `contract.drift.test.ts` checks it against that contract: set `AUDIOKIT_OPENAPI` to a path or URL of AudioKit's `openapi.yaml` before `pnpm test` (CI fetches it).

## Stack

SvelteKit 3 (Svelte 5 runes) · TypeScript · Drizzle ORM · Zod · Vitest + PGlite.

| Concern                         | Where it runs                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Web UI + REST API               | Netlify (`@sveltejs/adapter-netlify`)                                              |
| Database (PostgreSQL 17)        | Supabase project "ERMS" (efalpthvvmvpaikuxymd, eu-central-1, org Epsilon Records)  |
| Auth (magic link)               | Supabase Auth                                                                      |
| Master files (WAV)              | Cloudflare R2, private bucket; browser uploads with presigned URLs (decision 0011) |
| File storage (artwork)          | Supabase Storage                                                                   |
| Background processing (Phase 3) | Supabase Queues + Cron + an Edge Function                                          |

## Layout

```
src/
  env.ts                    validated env vars ($app/env/public, $app/env/private)
  hooks.server.ts           Supabase session, active org and RLS-scoped db on every request
  routes/                   UI ("Dark grid": src/app.css): /login, /auth/callback, /logout, /
  lib/server/
    db/                     schema, migrations source, UUIDv7
    audit.ts                withAudit(): change + audit entry in one transaction
    rbac.ts                 roles and scopes
    audio/                  AudioKit contract (Zod), AudioProvider, stub, webhook HMAC
    masters.ts              master uploads: who may upload, org-scoped keys, WAV checks
    storage/                R2 client (S3 API via aws4fetch): presigning and control calls
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

## Migrations and deploy

Schema migrations are plain SQL in `drizzle/`, generated with `pnpm db:generate` and applied
with `pnpm db:migrate`. Development runs them against the Docker Postgres (see above);
production is the Supabase project.

Production migrations are applied by the **Migrate production database** workflow
(`.github/workflows/migrate.yml`) whenever a commit lands on `main`, and on demand from the
Actions tab. The job runs in the `production` GitHub environment and:

1. runs `pnpm db:check` (journal and snapshot consistency in the repo),
2. runs `pnpm db:drift --warn`, which lists any migrations the database is missing,
3. runs `pnpm db:migrate` to apply the pending migrations, and
4. runs `pnpm db:drift` again, failing the job if the database is still behind.

The `production` environment holds the connection string, so the job runs unattended on every
merge; the environment secret scopes it to this workflow. One-time setup:

- Create the `production` environment under **Settings → Environments** if it does not exist.
- Add an environment secret named **`DATABASE_URL`** to `production`. It is the production
  Supabase connection string from the project's Connect panel, using the session pooler on
  port `5432` so migrations run in a normal session (the app keeps the transaction pooler on
  `6543`). Nothing in the repo sets or reads this secret, and the workflow never prints it.
- To require a manual approval before a run applies migrations, add required reviewers under
  the environment's **Deployment protection rules**. Without them, migrations run automatically.

The drift check hashes each `drizzle/*.sql` file the way drizzle does and compares those
hashes with the rows in `drizzle.__drizzle_migrations`, so a merged migration that never
reached the database shows up instead of passing silently (and a file edited after it was
applied shows up too). It also works by hand against any database:

```bash
DATABASE_URL=postgres://... pnpm db:drift          # exit 1 when behind
DATABASE_URL=postgres://... pnpm db:drift --warn  # report only
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
- No secrets in the repo. Netlify, Supabase and the GitHub Actions `production` environment hold production env vars and secrets.
- In production `DATABASE_URL` points at Supabase's transaction pooler (port 6543); the client already disables prepared statements for it.

## Master uploads (Cloudflare R2)

A recording page uploads a WAV master straight from the browser to R2. ERMS never handles the file body:

1. `POST /recordings/:id/masters` (owner or catalog manager) checks the file is a WAV (name, type, size up to 4 GiB), records a pending master, and returns a presigned PUT URL. Files over 100 MiB start a multipart upload instead, in 64 MiB parts.
2. `POST …/masters/:masterId/parts` signs part URLs, up to 16 at a time. URLs last 15 minutes.
3. The browser computes the file's SHA-256 while it uploads, then calls `POST …/masters/:masterId/complete`. ERMS completes the multipart upload, HEADs the object to confirm its size, reads its first 12 bytes to confirm a WAV header, and records the key, SHA-256, size and format. A file that fails is deleted and marked rejected.
4. `POST …/masters/:masterId/abort` cancels a pending upload.

Org isolation: object keys are `orgs/{org_id}/recordings/{recording_id}/masters/{master_id}.wav`, built on the server from the signed-in user's active org and never taken from the request. The `masters_key_in_org` check ties each key to its row, RLS limits rows to the user's orgs, and `erms_app` can only update an upload's progress, not its key, org or size.

Configuration: set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_MASTERS_BUCKET` in Netlify (and Supabase secrets for later Edge Functions). Uploads stay off until all four are set. The bucket must be private, with a CORS rule allowing `PUT` from the ERMS origins, the `Content-Type` request header, and exposing `ETag`. The CSP allows `connect-src https://*.r2.cloudflarestorage.com` for the uploads.

## Roadmap

Phase 0 foundation → 1 catalog core → 2 rights and contracts → 3 AudioKit integration → 4 metadata intelligence → 5 distribution and royalties → 6 consent-gated AI and agents.

Music intelligence (an artist graph from open music data) is out of scope for now and will be planned separately in AudioKit.
