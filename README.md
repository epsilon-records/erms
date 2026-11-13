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
`pnpm db:drift` reports the ledger up to date, and the `labelkit_app` role, 61 RLS policies and the
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

### Per-label AudioKit clients

Each label (org) uses its own AudioKit client, with its own key and webhook secret, issued by the
billing service (EPSILON-102; the contract is in knowledge#69). Until an org has one, its jobs use
the deployment-wide `AUDIOKIT_API_KEY` / `AUDIOKIT_WEBHOOK_SECRET`; once it has had one, that
fallback is closed to it for good, so a label whose client is revoked fails closed.

- **Where the secrets live.** In `audiokit_label_clients`, sealed with AES-256-GCM
  (`src/lib/server/audiokit-credentials.ts`). The sealing key is `AUDIOKIT_CREDENTIALS_KEY`, held in
  the environment and not in the database, so a dump or the nightly backup holds nothing usable.
  Supabase Vault was not used: it was not available to verify on the local stack the database tests
  run on, and a sealing key outside the database also keeps the nightly backups unreadable. No role but the owner has any privilege on the
  table (migration `0021`), so members read nothing through RLS, PostgREST or the app role. The
  `rls-cases` suite pins this.
- **Setup.** Set `AUDIOKIT_CREDENTIALS_KEY` (`<id>:<base64 of 32 random bytes>`, e.g.
  `openssl rand -base64 32`; comma-separate entries to rotate the key itself, first one seals),
  `AUDIOKIT_BILLING_URL` and `LABEL_CLIENTS_ADMIN_TOKEN`, all server-side and Functions/Runtime
  scoped on Netlify. The token never goes in the repo, a log or a response.
- **Issuing.** An owner posts `action=issue` (or `rotate`) to `/org/audiokit-client`. The org is the
  signed-in member's own. Billing returns the key and secret once and they are sealed as they
  arrive. The reconcile schedule then activates a client once billing reports it `synced`, and
  revokes a replaced client when none of its jobs is unfinished.
- **Webhooks.** A label's jobs carry `webhook.url` = `/api/audiokit/webhook/{client_id}`. The route
  picks the secret by client id before parsing the body, and only touches jobs submitted under that
  client. The original `/api/audiokit/webhook` stays for fallback jobs only.

### Uptime prober

`netlify/functions/uptime-probe.mjs` (shared decision 0010) covers the endpoints Sentry's single
uptime monitor does not: `billing.audiokit.ai/ready`, `console.audiokit.ai`, `audiokit.ai` and
`labelkit.co/login` and `erms.epsilonrecords.com/login`. Every 5 minutes it GETs each one with a 10 s timeout, following
redirects (`console.audiokit.ai/` answers 303 to `/login`; the final answer is what counts). A
failed probe is retried once after 2 s, so a one-off network error inside the function does not
alert. If the retry also fails, a non-2xx final answer, a timeout or a network error sends one
Sentry error event for that endpoint to
the `erms` project, with `environment=production`, the tags `probe_endpoint`, `probe_reason` and
`probe_status`, and the fingerprint `uptime-probe` + endpoint. A long outage is therefore one issue
per endpoint, and rule 6309992 emails on its first event. Resolve the issue once the endpoint
recovers so the next outage emails again as a regression.

`UPTIME_PROBE_EXTRA_URLS` (optional, comma or space separated http(s) URLs) adds endpoints to the
four above, so the failure path can be tested live with no code deploy: set it to one URL that
answers 404, wait one run, check Sentry and the email, then delete the variable and resolve the
test issue. Unset in normal operation.

`UPTIME_PROBE_MONITOR_SLUG` (optional) is the heartbeat that watches the prober itself. Set it
to the slug of a Sentry cron monitor in the same project, and every run sends that monitor one
`ok` check-in alongside its events; a prober that stops running then shows as a missed check-in.
The check-in carries no monitor configuration, so it never creates a monitor: create the monitor
in Sentry first (schedule `*/5 * * * *`, UTC, environment `production`), then set the variable
(scope: Functions). Unset, nothing is sent. A refused check-in is logged and does not fail the
run.

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
- App queries never run as the table owner. Routes use `locals.db`, which runs each call in a transaction as the `labelkit_app` role on behalf of the signed-in user, so RLS checks every read and write (`src/lib/server/db/scoped.ts`). A test fails if any other file imports the owner connection; the machine routes and the owner-only `/org/audiokit-client` route are its allowlisted exceptions.
- Links between catalog rows carry `org_id` in their foreign keys, so the database refuses links across orgs.
- `src/lib/server/tenancy.test.ts` proves one org cannot read, write or link into another.
- Security headers: SvelteKit sets a nonce-based CSP (`vite.config.ts`); `hooks.server.ts` and `netlify.toml` add HSTS, frame, referrer and permissions headers. Unexpected errors are logged server-side as JSON with a short reference; the browser sees only the reference.
- CI also runs `pnpm audit` and a gitleaks scan of the full history; CodeQL and Dependabot run separately.
- No secrets in the repo. Netlify, Supabase and the GitHub Actions `production` environment hold production env vars and secrets.
- In production `DATABASE_URL` points at Supabase's transaction pooler (port 6543); the client already disables prepared statements for it.

## Members and invites

Owners manage their label's members at `/members` (EPSILON-87): list them with their role and
onboarding state, invite by email with a role, change a role, remove someone.

- **The database decides.** `labelkit_app` may insert, delete and update the `role` column of
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
  (see [Sign-in email](#sign-in-email) for which domain sends it). **Existing account, including a pending invitation:** reuse it without
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

## Sign-in email

Decision 0027 (EPSILON-147): Epsilon's staff get sign-in and invite email from
`auth.epsilonrecords.com`; everyone else, and any address with no membership yet, from
`auth.labelkit.co`. Supabase has one SMTP sender per project, so the choice is made by Supabase's
**Send Email auth hook**, which this app serves at `POST /api/auth/send-email`. Until the hook is
switched on in Supabase, every auth email still goes over SMTP from `auth.labelkit.co`, and the
route is unused.

**Why an endpoint in this app** rather than an Edge Function or a Postgres hook: the repo has no
Edge Functions (`[edge_runtime]` is off) and its other machine callers (the AudioKit webhooks) are
SvelteKit routes that verify a signature, with secrets in Netlify; a Postgres hook cannot call
Resend and wait for the answer, so it could not fail closed. The cost is that Netlify must answer
within Supabase's 5 s hook limit, cold start included. Supabase does not retry a timeout, and the
email's tokens are rolled back with it. So the handler gives itself 4 s from the start of the call
for the lookup and every send together. Each Resend call is capped at 3.5 s or what is left, and
the two emails of a secure email change go out at once, not one after the other.

- **What it does.** Verifies the Standard Webhooks signature (`webhook-id`, `webhook-timestamp`,
  `webhook-signature`, five-minute tolerance) on the raw body, looks up the account's org ids,
  picks the sender, renders the email and sends it through Resend with that sender's key. The
  Resend idempotency key is `<webhook-id>:<n>`. It dedupes only a replay of the same hook call.
  It does not dedupe Supabase's retries: Supabase makes a new `webhook-id` for every attempt
  (it retries network errors, and 429/503 answers that carry `retry-after`). So if a connection
  drops after Resend accepted the email, the retry sends a second copy of the same link or notice.
  Accepted here, since a duplicate is harmless. With two hook secrets (rotation) Supabase sends
  two signatures joined by `", "`; either one verifying is enough. Code:
  `src/lib/server/auth-email/`.
- **Database access.** The route has no signed-in user and never gets the owner connection.
  `hooks.server.ts` gives this exact path a runner that switches to `labelkit_auth_email` (migration
  `0025`): no login, no BYPASSRLS, no table rights, and EXECUTE on one SECURITY DEFINER function,
  `app_auth_email.member_org_ids(uuid)`, which returns that account's org ids and nothing else. The
  signature is checked before the runner is used.
- **Which sender.**
  - _Invite:_ the inviting org decides. The members page stores `invited_org_id` with the invite,
    so an invite to Epsilon for a brand-new address comes from `auth.epsilonrecords.com`, and an
    invite to another label comes from `auth.labelkit.co` even for someone who is already Epsilon
    staff. `invited_org_id` is user-editable metadata, so it is trusted for invite emails only.
  - _Everything else_ (sign-in link, signup, email change, notices): Epsilon's sender whenever
    Epsilon is one of the account's orgs, even if the person also belongs to other labels (Nate's
    decision, labelkit#73). The rule is per recipient, so other labels' people never get Epsilon
    mail.
- **Copy.** The invite ports `supabase/templates/invite.html` (it names the inviting label, links
  to `/auth/confirm` on Supabase's Site URL, `https://labelkit.co`, as the template's
  `{{ .SiteURL }}` did; `scripts/auth-redirects.mjs` holds that value). It does not use the request's
  host or the payload's `email_data.site_url`: Supabase fills the latter with the Auth API's own
  URL (`<project>.supabase.co/auth/v1`), not the Site URL. It calls the app ERMS from Epsilon's
  sender and LabelKit from LabelKit's. The hosted magic-link template was Supabase's `{{ .ConfirmationURL }}` default and
  is not in the repo, so sign-in and the other types get plain, neutral copy that names no label;
  their links are the same Auth `/verify` URL as before, so `/auth/callback` is unchanged. Every
  `email_action_type` in Supabase's schema has copy; an unknown one is refused. Recipients follow
  Supabase's own mailer: the "email address was changed" notice goes to the **old** address
  (`email_data.old_email`) so its owner hears about the change, and is refused if that is missing;
  every other notice goes to the account's address.
- **Fails closed.** A missing setting, a bad signature, a failed lookup, an unknown type or a
  refused send answers an error (`{"error":{"http_code","message"}}`), Supabase reports the
  sign-in as failed and nothing is sent. Supabase reads that body only from a 200/202 answer; for
  the 4xx/5xx statuses used here the person signing in sees a generic error ("Unexpected status
  code returned from hook: 502" and the like, reported as a 500), so the messages are for logs
  and tests. Rate limits are not shown to the user as such either. It never falls back to the other domain or to SMTP. Each
  call logs one JSON line (`"event":"auth_email_hook"`, outcome, sender domain, Resend ids), never
  the address or a token.

| Variable                    | What it is                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------- |
| `SEND_EMAIL_HOOK_SECRET`    | The hook's secret, as Supabase generates it (paste it whole). Verifies every call.          |
| `RESEND_KEY_EPSILON`        | Resend key limited to `auth.epsilonrecords.com` (the existing `erms-supabase-smtp` key).    |
| `RESEND_KEY_LABELKIT`       | Resend key limited to `auth.labelkit.co` (the key Supabase's SMTP uses now).                |
| `AUTH_EMAIL_EPSILON_ORG_ID` | Epsilon's org id. Not a secret. `select id, name from orgs order by created_at` to find it. |

All four are server-only, set in Netlify's **production** context, scoped to Functions/Runtime.
None go in the repo.

### Switching it on

1. Merge; the deploy job applies migration `0025`. Confirm with `pnpm db:drift`.
2. In Netlify (site `labelkit`, production), set `RESEND_KEY_EPSILON`, `RESEND_KEY_LABELKIT` and
   `AUTH_EMAIL_EPSILON_ORG_ID`.
3. In Supabase (project `efalpthvvmvpaikuxymd`): **Authentication → Auth Hooks → Add hook → Send
   Email hook**. Hook type **HTTPS**; URL `https://labelkit.co/api/auth/send-email`; press
   **Generate secret** and copy it. Leave the hook **disabled** for now and save. Do not change the
   SMTP settings: they are the rollback.
4. Set `SEND_EMAIL_HOOK_SECRET` in Netlify to that secret, then redeploy so the functions read it.
5. Check the route is live and refusing unsigned calls:
   `curl -si -X POST https://labelkit.co/api/auth/send-email -H 'content-type: application/json' -d '{}'`
   must answer `401` with `Send Email hook rejected: missing`. A `500` naming a variable means one
   is not set.
6. Enable the Send Email hook in Supabase. From now on SMTP is not used.
7. Prove it (EPSILON-147's done-when): an Epsilon member signs in and the mail arrives from
   `auth.epsilonrecords.com`; a test org's member signs in and it arrives from `auth.labelkit.co`.
   Check the Resend logs (domain per email), Supabase's Auth logs and the Netlify function log
   (`auth_email_hook` … `"outcome":"sent"`).

### Rolling back to SMTP

In Supabase, **Authentication → Auth Hooks → Send Email hook → disable** (or delete it). Supabase
goes back to its SMTP sender, `auth.labelkit.co`, at once; nothing in the app needs to change and no
deploy is needed. The Netlify variables can stay.

## Public API (`/v1`)

Owners create API keys on `/org/api-keys` (EPSILON-137, migration 0026). A key is
`lk_<prefix>_<secret>`. Only its SHA-256 is stored, and the key itself is shown once. Every key acts
as its own `agent` member of the label. The request hook looks the key up on the owner connection and
then runs the request as that agent with `scopedTo`, so `/v1` goes through the same RLS as the app.

- **Sign-in:** `/v1` accepts only `Authorization: Bearer`, never the session cookie.
- **Scopes:** `catalog:read` and `processing:request`, a subset of the agent role in `rbac.ts`.
- **Limits:** at most 10 live keys per label. Keys are created and revoked only through
  `app.create_api_key` and `app.revoke_api_key`, which write the audit entry. Revoking a key deletes
  its agent membership too.
- **Members and seats:** agent members don't appear on the Members page and don't use a plan seat.
- **Spec:** `docs/openapi.yaml`. `openapi.test.ts` checks that it lists exactly the routes under
  `src/routes/v1`.

## Branding and custom domains

Every label's owners set its branding on `/org/branding`: display name, accent colour, tab icon and
the domain it is served on. No label is special-cased in code (knowledge labelkit 0034, 0036);
Epsilon's `erms.epsilonrecords.com` uses the same setting as any other label's domain.

A domain is set up in two steps (`src/lib/server/custom-domain.ts`, migration 0032):

1. The owner enters it. `app.request_org_domain` stores it with a token, and the page shows two DNS
   records: a TXT record at `_labelkit-verify.<domain>` holding `labelkit-verify=<token>`, and a
   CNAME to `labelkit.netlify.app` (an A record to `75.2.60.5` for an apex domain).
2. The owner clicks **Check DNS and set up**. The app reads the TXT record, adds the domain as an
   alias on this Netlify site (Netlify then issues its certificate), adds
   `https://<domain>/auth/callback` to Supabase Auth's redirect allowlist, and then
   `app.activate_org_domain` makes it the label's `custom_domain`. A domain another label already
   uses is refused.

Removing a domain, or moving to a new one, takes the old one off Netlify and Supabase Auth.

Provisioning needs four variables in Netlify's production context:

| Variable                | What it is                                                                                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NETLIFY_API_TOKEN`     | A Netlify personal access token (User settings → Applications → New access token). Netlify tokens can't be scoped to one site, so create it on an account that is a member of this team only. |
| `NETLIFY_SITE_ID`       | This site's id (Site configuration → Site details). Not a secret.                                                                                                                             |
| `SUPABASE_ACCESS_TOKEN` | A Supabase personal access token (Account → Access tokens). It reaches every project the account can, so use an account with access to this project only.                                     |
| `SUPABASE_PROJECT_REF`  | The project ref, the subdomain of the Supabase API URL. Not a secret.                                                                                                                         |

Without them, a verified domain waits with a message saying which variable is missing; nothing else
is affected.

## Closing and purging a label

An owner closes a label at `/org/close`, by typing its name (migration 0027,
`app.close_org`). A label on a renewing Label plan has to cancel the plan first.

- **While closed:** every member is sent to `/org/closed`. Owners can still export the label and
  reopen it with `app.reopen_org` until `purge_after`, which is 30 days after closing.
- **The daily purge:** `netlify/functions/purge-orgs.mjs` calls `POST /api/internal/purge-orgs`
  with the worker secret. For each label that is due, it:
  1. revokes the label's AudioKit client at billing;
  2. deletes every object under `orgs/<id>/` in R2;
  3. calls `app.purge_org`, which deletes every row the label owns and the org itself.
- **Audit log:** `app.purge_org` also deletes the label's audit log entries. The append-only
  trigger allows this only inside that function, by checking `app.purge_org`; `labelkit_app` has no
  DELETE on `audit_log`.
- **Failures:** if any step fails, the label stays as it is for the next run. Without R2
  configured, a label that has masters is never purged.

## Master uploads (Cloudflare R2)

A recording page uploads a WAV master straight from the browser to R2. ERMS never handles the file body:

1. `POST /recordings/:id/masters` (owner or catalog manager) checks the file is a WAV (name, type, size up to 4 GiB), records a pending master, and returns a presigned PUT URL with the headers the browser must send. The single PUT is signed with `If-None-Match: *`, so R2 accepts it only while the key is empty: once the file is stored, the URL cannot replace it. Files over 100 MiB start a multipart upload instead, in 64 MiB parts.
2. `POST …/masters/:masterId/parts` signs part URLs, up to 16 at a time. URLs last 15 minutes.
3. The browser computes the file's SHA-256 while it uploads, then calls `POST …/masters/:masterId/complete` with it. ERMS completes the multipart upload and HEADs the object. A wrong size is rejected at once, without reading the file. Otherwise the master becomes `verifying`, and the browser's hash is kept only as `claimed_sha256`. If R2 already completed the multipart upload (a retry), a HEAD showing the declared size is enough to carry on.
4. The background check (below) reads the object, and the master becomes `ready` with ERMS's own SHA-256, or it is rejected and deleted. The recording page shows it as **Checking** until then.
5. `POST …/masters/:masterId/abort` cancels a pending upload, and removes the object in case R2 had already completed it.
6. `DELETE …/masters/:masterId` (owner or catalog manager) removes the object from R2 and
   deletes the row in one transaction, audited as `master_delete`. A pending multipart upload
   is aborted first. The request must carry `{ "removalConfirmed": "yes" }` (decision 0023);
   the recording page sends it only after its inline confirm step, and without it the route
   answers 400 and touches nothing.

Only `ready` masters are used: analysis jobs, the export and master downloads all require it.

### The background check (EPSILON-120)

A master can be up to 4 GiB, which is too much to read inside a request. So:

- `netlify/functions/master-verify.mjs` runs every minute. It calls `POST /api/internal/verify-masters` with the worker secret, which leases up to 5 `verifying` masters and returns a presigned GET for each. It then starts one `master-verify-background` invocation per master, all at once, so the run stays under Netlify's 30-second limit for scheduled functions.
- `netlify/functions/master-verify-background.mjs` is a Netlify background function, which can run for up to 15 minutes. It holds no database or R2 credentials. It streams the object through the GET with a 12-minute overall deadline, computes its SHA-256, size and first 12 bytes, and posts them back to the same route.
- The route decides. The size must match, the header must be WAV, and the hash must equal the claimed one; then the master becomes `ready`, audited as `upload_verified`. Otherwise it is rejected and deleted, audited as `upload_reject`.
- A lease lasts 20 minutes, longer than a background function can run. A check that crashes or never reports keeps the master `verifying`, and it is leased again, with a new token, once the lease runs out. A late result for an old lease is ignored. A read that fails or hits its deadline ends the lease, and the next try waits 2, 4, 8, then 16 minutes, so a short outage cannot use up every attempt. After 5 reads that failed or never reported, or at once if the reader gets 404 and R2 tells the route the key does not exist (`NoSuchKey`; a 404 for a missing bucket only counts as a failed read), the master is rejected and its object deleted, with the reason _LabelKit could not read the stored file; upload it again._ A master is never trusted because its check went missing.
- Netlify's `URL` is the production address in every context. On a deploy preview or branch deploy, both functions call the deploy's own permalink, `https://<deploy id>--<SITE_NAME>.netlify.app`, built from the runtime `context.deploy.id` and `SITE_NAME`. If those are missing outside production, they fail rather than call production. The background function retries a failed result post up to 3 times.

Masters that became ready before this check carry the browser's hash. `scripts/reverify-ready-masters.mjs` is a one-off, read-only re-check of them, run with the owner `DATABASE_URL` and the R2 variables. It reports any mismatch and changes nothing.

Org isolation: object keys are `orgs/{org_id}/recordings/{recording_id}/masters/{master_id}.wav`, built on the server from the signed-in user's active org and never taken from the request. The `masters_key_in_org` check ties each key to its row, RLS limits rows to the user's orgs, and `labelkit_app` can only update an upload's progress, not its key, org or size.

Configuration: set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_MASTERS_BUCKET` in Netlify (and Supabase secrets for later Edge Functions). Uploads stay off until all four are set. The bucket must be private, with a CORS rule allowing `PUT` from the ERMS origins, the `Content-Type` and `If-None-Match` request headers, and exposing `ETag`. Without `If-None-Match` in the rule, browsers refuse single-PUT uploads. The CSP allows `connect-src https://*.r2.cloudflarestorage.com` for the uploads.

## Roadmap

Phase 0 foundation → 1 catalog core → 2 rights and contracts → 3 AudioKit integration → 4 metadata intelligence → 5 distribution and royalties → 6 consent-gated AI and agents.

Music intelligence (an artist graph from open music data) is out of scope for now and will be planned separately in AudioKit.

### Cloudflare Web Analytics on the public pages

Under shared decisions 0011 and 0016, Cloudflare Web Analytics runs on LabelKit's public, signed-out
pages and nowhere else: `/` (the landing page only, not the dashboard), `/login`, `/signup`,
`/privacy` and `/terms`. Signed-in app pages, `/signup/label`, `/auth/*`, the error page, label
workspaces and branded domains never load the beacon. The reason is that the beacon reads the address
when it sends, so after a client-side navigation into the app it could report a sensitive path.

- `src/lib/components/PublicAnalytics.svelte` is mounted by those five pages only, never by a layout.
  It loads `https://static.cloudflareinsights.com/beacon.min.js` (`spa: false`, `no-referrer`) once
  per document. The guards in `src/lib/public-analytics.ts` follow audiokit.ai's loader: the token
  is set, Netlify's build context is `production`, the origin is exactly `https://labelkit.co`, the
  visitor is signed out, and the current URL, the document's original navigation and the referrer
  have no query or fragment and are on the allowed paths.
- A document with the beacon turns every later navigation to another page into a full page load, so
  the beacon never follows the visitor into the app. Jumps within the same page (`#pricing`) stay
  client-side.
- Configuration: `PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN`, the public site token of a manual
  (JS snippet) Web Analytics site for `labelkit.co`. Set it in Netlify's production context only.
  If it is unset or isn't 32 hex characters, nothing loads. Don't use Cloudflare's automatic setup
  for labelkit.co: it would inject the beacon on every page, the app included.
- CSP: `script-src https://static.cloudflareinsights.com` and `connect-src https://cloudflareinsights.com`
  (`vite.config.ts`).
- `src/lib/public-analytics.test.ts` pins which pages mount the loader, tests the guards and the
  full-load boundary, and checks the CSP and the privacy notice.

### Disabled first-party app performance pilot (EPSILON-107)

Both `APP_METRICS_ENABLED` and `PUBLIC_APP_METRICS_ENABLED` default to **false**.
Keep both false pending independent review, migration review, merge and enablement approval.
The browser additionally requires the production build context and one of the exact production origins
`https://labelkit.co` or `https://erms.epsilonrecords.com` (never a preview host). No deployment configuration is changed by this PR.
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
Unexpected credential/tracing headers are rejected. Netlify adds W3C transport
trace context after the browser sends the request; the exact metrics hook discards
`traceparent`, `tracestate`, `x-nf-trace-span-id` and AWS transport tracing only when the adapter-owned
Netlify site context matches this deployment. No trace value is read, persisted or
forwarded. Other hosts retain strict tracing rejection, and cookie/auth/Sentry
baggage checks remain enforced on Netlify. The endpoint still necessarily
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
Ordinary label owners, anon, authenticated and labelkit_app have no metrics access.

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
