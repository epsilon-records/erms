# ERMS — Epsilon Records Management System

The label's system of record: catalog, rights, releases, distribution and royalties.
Audio processing is delegated to [AudioKit](https://github.com/epsilon-records/audiokit) through an `AudioProvider` interface that speaks AudioKit's OpenAPI contract. `contract.drift.test.ts` checks it against that contract: set `AUDIOKIT_OPENAPI` to a path or URL of AudioKit's `openapi.yaml` before `pnpm test` (CI fetches it).

## Stack

SvelteKit 3 (Svelte 5 runes) · TypeScript · Drizzle ORM · Zod · Vitest on the local Supabase stack.

| Concern                         | Where it runs                                                                      |
| ------------------------------- | ---------------------------------------------------------------------------------- |
| Web UI + REST API               | Netlify (`@sveltejs/adapter-netlify`)                                              |
| Database (PostgreSQL 17)        | Supabase project "ERMS" (efalpthvvmvpaikuxymd, eu-central-1, org Epsilon Records)  |
| Auth (magic link)               | Supabase Auth                                                                      |
| Master files (WAV)              | Cloudflare R2, private bucket; browser uploads with presigned URLs (decision 0011) |
| File storage (artwork)          | Supabase Storage                                                                   |
| Background processing (Phase 3) | Netlify Scheduled Functions call ERMS's authenticated AudioKit job routes          |

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
    members.ts              org members: list, invite, change role, remove (owners only)
    auth-admin.ts           Supabase Auth admin client, for invites only (the one secret-key path)
    storage/                R2 client (S3 API via aws4fetch): presigning and control calls
drizzle/                    SQL migrations (RLS, append-only audit log, same-org keys, app role)
```

## Development

```bash
pnpm install
cp .env.example .env        # enough for `pnpm build`; sign-in needs the real publishable key
supabase start              # local Supabase stack, PostgreSQL 17 (CLI 3.1.0-beta.26+); needs Docker
pnpm db:migrate
pnpm dev
pnpm test                   # unit + database tests; the database tests need `supabase start`
pnpm db:pgversion           # README, Supabase config and the live server agree
```

**Building without credentials.** `cp .env.example .env && pnpm build` works in a fresh clone, with
no stack and no keys. `.env.example` holds the local stack's `DATABASE_URL` and a fake
`PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`placeholder-not-a-real-key`), which pass the checks in
`src/env.ts`. The build only checks that values are present and well formed; it does not connect to
anything. To use the app (`pnpm dev`, sign-in), replace the key with the ERMS project's publishable
key. `.env` is gitignored, and Netlify and CI set their own values, so the placeholder never reaches
a deploy. Without `.env`, or with a required variable missing, the build stops with SvelteKit's
`env_invalid` error naming the variable. That is on purpose.

The database tests run on the **local Supabase stack**, not on an engine of our own: production's
server build (PostgreSQL 17), Supabase's `anon` / `authenticated` / `service_role` with their real
grants, and the app's own driver (`createDb`, postgres-js, `prepare: false`). Once per run,
`src/lib/server/test-db.global.ts` builds a template database — Supabase's default privileges, then
every migration — and each test gets a fresh copy of it. `TEST_DATABASE_URL` overrides the stack's
default URL; it must be local.

So `pnpm test` needs the stack running (`supabase start`, which needs Docker). Without it the
database tests fail, each with:

```
Error: Cannot reach the database tests' Postgres at 127.0.0.1 (connect ECONNREFUSED 127.0.0.1:54322).
Start the local Supabase stack and run the tests again:
  supabase start   (CLI 3.1.0-beta.26 or later: the first line with a PostgreSQL 17 image)
```

and the run exits non-zero. There is no fallback engine and no skip, because a fallback is how a
green run stops meaning anything (decision 0018). Tests that need no database still run and pass,
so in a run without the stack, the only failures should be that error.

Development and the tests share one stack. `pnpm dev` uses the stack's own `postgres` database;
the tests only ever create and drop their own `erms_test_*` copies, so they never touch dev data.
`pnpm test:rls` is the exception: it seeds and removes its fixed fixture rows in the database
behind `DATABASE_URL`.

## Migrations and deploy

Schema migrations are plain SQL in `drizzle/`, generated with `pnpm db:generate` and applied
with `pnpm db:migrate`. Development runs them against the local Supabase stack (see above);
production is the Supabase project.

**Version discipline.** All three places that name a PostgreSQL major must agree — the stack table
above (production, stated by Nate on 2026-11-07), `supabase/config.toml` (development, tests and
CI), and the live server behind `DATABASE_URL`.
`pnpm db:pgversion` (`scripts/check-pg-version.mjs`) compares them and fails on a split, and CI runs
it after applying the migrations. CI applies the complete migration chain on PostgreSQL 17.11;
`pnpm db:drift` reports the ledger up to date, and the `erms_app` role, 61 RLS policies and the
`unaccent` extension all come up as intended.

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

### AudioKit job schedule

Netlify Scheduled Functions submit queued AudioKit jobs every minute and reconcile submitted jobs
every 15 minutes. The functions call `POST /api/audiokit/worker` and
`POST /api/audiokit/reconcile` on the deployed ERMS site using the `WORKER_SECRET`
bearer token. Netlify runs these schedules in UTC on published deploys; use **Functions → Run now**
in the Netlify UI to invoke either function manually. No GitHub Actions or Supabase cron is involved.

`WORKER_SECRET` is one production variable that both sides read: the scheduled function sends it as
a bearer token and the route compares it against the same value. Any long random string works, but it
must be scoped to **Functions** and **Runtime** (not just Builds), and the site must be redeployed
after it is set. The function uses Netlify's built-in `URL` variable to find the deployed site; no URL
variable needs to be added.

The functions also send an `origin` header. SvelteKit's CSRF guard rejects a POST that carries
neither a same-origin `origin` header nor a JSON `content-type` with 403 _Cross-site POST form
submissions are forbidden_, before the route's own bearer check runs; a bare scheduled-function POST
has neither, so the schedule silently 403s without it.

### Uptime prober

`netlify/functions/uptime-probe.mjs` (shared decision 0010) covers the endpoints Sentry's single
uptime monitor does not: `billing.audiokit.ai/ready`, `console.audiokit.ai`, `audiokit.ai` and
`erms.epsilonrecords.com/login`. Every 5 minutes it GETs each one with a 10 s timeout, following
redirects (`console.audiokit.ai/` answers 303 to `/login`; the final answer is what counts). A
non-2xx final answer, a timeout or a network error sends one Sentry error event for that endpoint to
the `erms` project, with `environment=production`, the tags `probe_endpoint`, `probe_reason` and
`probe_status`, and the fingerprint `uptime-probe` + endpoint. A long outage is therefore one issue
per endpoint, and rule 6309992 emails on its first event. Resolve the issue once the endpoint
recovers so the next outage emails again as a regression.

It reads `SENTRY_DSN` (or, failing that, `PUBLIC_SENTRY_DSN`) at runtime, so the variable must be
scoped to **Functions**. Without one the run fails, and if Sentry refuses an event the run fails
too. Either way the failure shows in the function's Netlify log, as does one JSON line per endpoint
per run.

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

## Members and invites

Owners manage their label's members at `/members` (EPSILON-87): list them with their role and
onboarding state, invite by email with a role, change a role, remove someone.

- **The database decides.** `erms_app` may insert, delete and update the `role` column of
  `memberships`, and only where `app.has_role(org_id, ['owner'])`: an owner of one label cannot
  place anyone in another (refused with 42501), and `agent` is never handed to a person. The
  `memberships_keep_one_owner` trigger keeps at least one owner per org, for every connection
  including the owner's; deleting the org itself is the exemption. Membership identity (`org_id`,
  `user_id`) is immutable even on the owner connection (`drizzle/0018_membership_identity.sql`).
  See `drizzle/0017_members_manage.sql`
  and the `members:` cases in `scripts/rls-cases.mjs`. Every change is written through `withAudit()`
  as `member_invite`, `member_role` or `member_remove`, without the person's address. Role changes
  and removals lock the membership before reading its audit value, so concurrent changes record
  the actual preceding role and identical role submissions become no-ops.
- **Sending the invite** needs Supabase's Auth admin API, so it uses the secret key
  (`SUPABASE_SECRET_KEY`), server-only and read by `src/lib/server/auth-admin.ts` alone; only the
  members route imports that module (`auth-admin-access.test.ts`). It calls Auth and nothing else:
  the membership row is still written under RLS. The route asks the database whether the caller
  owns the org before any email goes out. Without the key, invites are off and the page says so.
- **New address:** Supabase creates the account and sends its Invite email through the one sender
  (`auth.epsilonrecords.com`, decisions 0004 and 0021). **Existing account, including a pending invitation:** reuse it without
  resending mail or changing its shared metadata. Supabase would resend a pending account's stored
  first-label copy, ignoring the second label's invite data. The person uses their invitation or
  signs in, then selects the added label in the switcher. Success copy does not expose account
  existence or promise a new email; actual send outcome stays in the org-scoped audit metadata.
  Failed Auth lookups report unknown state, never confirmed evidence of an unsigned-in account.
- **The email** is `supabase/templates/invite.html` with the subject in `supabase/config.toml`. It
  names the label from `invited_org_name` and never Epsilon, because one template serves every
  label. Its link lands on `/auth/confirm` with the token hash: an invite is opened in another
  browser than the one that sent it, so `/auth/callback`'s PKCE code cannot serve it. In
  production the template is pasted into the hosted project's Invite email.

Auth and the membership transaction are separate operations: an email/account may remain if the
subsequent database write fails. Retry an authorized add; never delete a shared Auth account as
compensation. The read-only existing-account check is not atomic with Supabase account creation:
simultaneous first invitations can race, so it does not prove per-invite routing or mail atomicity.
The confirmation flow uses the existing verified-membership org selection, not a new label-specific
redirect. Hosted configuration and the published-site decision-0022 proof remain release prerequisites.

## Master uploads (Cloudflare R2)

A recording page uploads a WAV master straight from the browser to R2. ERMS never handles the file body:

1. `POST /recordings/:id/masters` (owner or catalog manager) checks the file is a WAV (name, type, size up to 4 GiB), records a pending master, and returns a presigned PUT URL. Files over 100 MiB start a multipart upload instead, in 64 MiB parts.
2. `POST …/masters/:masterId/parts` signs part URLs, up to 16 at a time. URLs last 15 minutes.
3. The browser computes the file's SHA-256 while it uploads, then calls `POST …/masters/:masterId/complete`. ERMS completes the multipart upload, HEADs the object to confirm its size, reads its first 12 bytes to confirm a WAV header, and records the key, SHA-256, size and format. A file that fails is deleted and marked rejected.
4. `POST …/masters/:masterId/abort` cancels a pending upload.
5. `DELETE …/masters/:masterId` (owner or catalog manager) removes the object from R2 and
   deletes the row in one transaction, audited as `master_delete`. A pending multipart upload
   is aborted first. The request must carry `{ "removalConfirmed": "yes" }` (decision 0023);
   the recording page sends it only after its inline confirm step, and without it the route
   answers 400 and touches nothing.

Org isolation: object keys are `orgs/{org_id}/recordings/{recording_id}/masters/{master_id}.wav`, built on the server from the signed-in user's active org and never taken from the request. The `masters_key_in_org` check ties each key to its row, RLS limits rows to the user's orgs, and `erms_app` can only update an upload's progress, not its key, org or size.

Configuration: set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_MASTERS_BUCKET` in Netlify (and Supabase secrets for later Edge Functions). Uploads stay off until all four are set. The bucket must be private, with a CORS rule allowing `PUT` from the ERMS origins, the `Content-Type` request header, and exposing `ETag`. The CSP allows `connect-src https://*.r2.cloudflarestorage.com` for the uploads.

## Roadmap

Phase 0 foundation → 1 catalog core → 2 rights and contracts → 3 AudioKit integration → 4 metadata intelligence → 5 distribution and royalties → 6 consent-gated AI and agents.

Music intelligence (an artist graph from open music data) is out of scope for now and will be planned separately in AudioKit.

### Disabled first-party app performance pilot (EPSILON-107)

Both `APP_METRICS_ENABLED` and `PUBLIC_APP_METRICS_ENABLED` default to **false**.
Keep both false pending independent review, migration review, merge and enablement approval.
The browser additionally requires the production build context and exact
`https://erms.epsilonrecords.com` origin. No deployment configuration is changed by this PR.
Cloudflare app analytics remain inactive. No new vendor, subscription or database is added.

Only the literal framework route ID `/` maps to `catalog_home`; all other routes are
excluded before serialization. The wire contract is exactly `v`, `route`, `metric`, `ms`;
shared golden fixtures are in `tests/fixtures/app-metrics-v1.json`. Initial
`document_mount_ms` measures performance time origin to the first root client mount,
not load-event completion, visual readiness or a Core Web Vital. Conservative
`client_navigation_ms` needs two different allowed route symbols, so this first
one-route slice emits no client navigation samples. No URL, referrer, performance
entry name, forms, storage, cookies or identity are inputs to the collector.

Native browser fetch posts to `/api/app-metrics` with credentials omitted, no referrer,
redirect errors, no cache, a one-second abort deadline and no retry/beacon/flush.
At most one request is in flight, at least one second separates sends and at most
20 sends are permitted per document. Navigation never awaits collection. The exact
endpoint bypasses Supabase Auth and Sentry request handling before either runs;
Sentry browser fetch breadcrumbs, spans and trace propagation exclude the collector.
Unexpected credential/tracing headers are rejected. The endpoint still necessarily
receives ordinary network metadata, including addresses, user agents and fetch
metadata at the host. This code does not log, store or forward that metadata;
this is **not** a claim about Netlify/CDN/access-log retention or unrelated Sentry traffic.

Controller-approved **technical defaults**, not a Nate-explicit retention decision:
current UTC day plus seven previous days, at most 2,000 accepted observations/day
across replicas, eight finite histogram buckets and two metric codes. Private
`app_metrics.app_performance_daily` stores only day, route/metric/bucket codes and
counts; the all-zero code key holds the daily global budget, not an event.
One route permits at most 136 hot rows. Bucket edges in milliseconds are
`0,100,250,500,1000,2500,5000,10000,60001`; distributions support coarse percentile
estimates, never exact p95/mean, visitors, attribution or per-org outcomes.
Anonymous samples can be forged and saturation biases measurements; Origin screening
is not authentication. An instance-wide burst of five with 30 attempts/minute and two
concurrent ingestion calls bounds app work, not all external hosting request costs.
Existing quota headroom and incremental platform cost remain unmeasured; no paid
upgrade is authorized.

Migration `0019_app_performance_aggregates` is reviewable code, **not authorization to
apply it to production**. It creates a private non-PostgREST schema, table with RLS and
no tenant policies, separate NOLOGIN/NOBYPASSRLS execute-only ingest/prune roles, and
fixed-search-path security-definer functions with finite input validation. Only the
request hook/client own privileged connection access; routes execute through
`locals.db` after a restricted role switch without a user identity. A separate small
pool has one-second connection/queue deadlines; canceled queued work is removed by
postgres-js before execution. Transactions use 100ms lock/250ms statement deadlines.
The atomic budget update and histogram increment commit or roll back together.
Ordinary label owners, anon, authenticated and erms_app have no metrics access.

Expired rows are deleted on accepted writes and by `app-metrics-prune`, scheduled
**daily at 00:10 UTC** (`10 0 * * *`) on Netlify. It calls the exact
`/api/internal/app-metrics-prune` endpoint using the existing `WORKER_SECRET` pattern.
Deletion remains active while ingestion is disabled; the maintenance role can only
execute prune. Daily pruning can leave expired rows for about 24 hours, longer during
scheduler outages. Readback always excludes old days. Disabled ingestion never opens
a database connection; pruning needs the reviewed migration to exist first.

Operator-only SQL, using existing controlled database access (no HTTP read endpoint):

```sql
-- Current hot histogram only; never join to business/user tables.
SELECT day_utc, route_code, metric_code, bucket, sum(count) AS observations
FROM app_metrics.app_performance_daily
WHERE day_utc >= (clock_timestamp() AT TIME ZONE 'UTC')::date - 7
  AND route_code = 1 AND metric_code IN (1,2) AND bucket BETWEEN 1 AND 8
GROUP BY day_utc, route_code, metric_code, bucket
ORDER BY day_utc, metric_code, bucket;

-- Emergency full hot-store purge (operator action, not invoked by this PR).
DELETE FROM app_metrics.app_performance_daily;
```

There are no identities for individual-user deletion. SQL deletion does not erase
existing snapshots, backups, WAL or already retained pages. Their existing provider/
operator recovery retention has not been changed or verified here; final deletion
must not be promised from this hot window. Exclude this nonbusiness schema from
logical catalogue backups where possible after review. No production backup policy
change is included.

Privacy verification: `node scripts/app-metrics-privacy.cdp.mjs` uses Node 22's native
WebSocket and installed Chrome (`CHROME_BIN` override), with a disposable profile,
synthetic cookies/Auth redirects/entity IDs and an egress-denied SvelteKit fixture.
It imports the production collector, navigation component and Sentry browser hook;
the local wire receiver invokes the actual endpoint and restricted DB runner.
A disposable fixture-only SSR transform supplies loopback canonical origin and test
DB configuration; production artifacts have no localhost override. No collector request is fulfilled by
CDP. Without `METRICS_TEST_DATABASE_URL` this is **transport/filtering proof only**,
not storage proof; CI supplies an isolated migrated database on its pinned real
Supabase stack and checks actual aggregate readback. The browser fixture never loads
production Auth/business services or a developer `.env`. Its synthetic pagehide/
pageshow tests do not prove physical tab hiding, genuine BFCache or Netlify redirect
behavior; HTTP-only fake cookies do not establish Secure-cookie behavior over TLS.
Production platform logging/retention still requires operator review before enabling.
