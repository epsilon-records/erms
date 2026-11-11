# LabelKit gap analysis

Linear: [EPSILON-128](https://linear.app/epsilon-records/issue/EPSILON-128) · 2026-11-11

ERMS becomes the codebase for **LabelKit**, a self-serve product for independent labels. Epsilon's own ERMS becomes the first branded customer on it. This doc lists:

1. what in the code today assumes Epsilon is the only customer, and
2. what LabelKit still needs.

It changes no code.

## Summary

The base is reusable. Every request is scoped to an org, isolation is enforced by RLS (with tests), member invites and roles work, and an org can already hold several imprints (`labels`). The gaps are mainly around the product:

- No way to sign up yourself.
- No per-org branding, domain, plan or feature settings.
- No public API.
- No distribution or royalty side.

A small set of hard-coded Epsilon assumptions needs to move into settings.

## 1. Epsilon-specific assumptions in the code

| Where | What | Change |
| --- | --- | --- |
| `src/routes/+layout.svelte` (title, brand mark) | Product name is hard-coded as "ERMS" | Product name **LabelKit**; tenant display name per org (Epsilon shows "ERMS") |
| `src/hooks.client.ts`, `src/lib/app-metrics-contract.ts` | Metrics origin fixed to `https://erms.epsilonrecords.com` | Read from config; allow each tenant domain |
| `scripts/auth-redirects.mjs` (`AUTH_SITE_URL`) | One Supabase Auth site URL | Redirect allowlist per tenant domain, plus the LabelKit app domain |
| `netlify/functions/uptime-probe.mjs` | Probes `erms.epsilonrecords.com/login` only | Probe the LabelKit app domain; tenant domains optional |
| `src/lib/server/import/symphonic.ts`, `src/routes/import/*`, `src/routes/+page.svelte`, `src/routes/onboarding/+page.svelte`, `src/routes/releases/+page.svelte` | Import accepts only a SymphonicMS inventory export, and the UI copy says so | Importer interface with Symphonic as one adapter; add a generic CSV template (and later DDEX) |
| `src/lib/server/audiokit-clients.ts`, `src/env.ts`, `src/routes/api/audiokit/webhook/+server.ts` | An org without its own AudioKit client falls back to the deployment-wide key, whose header comment calls it "Epsilon's unlimited key" | For paying tenants, create a client per org at signup; limit or remove the fallback so one tenant cannot use Epsilon's quota |
| Auth email sender `auth.epsilonrecords.com` (Resend, from earlier decisions) | Login and invite emails come from an Epsilon domain | Send from a LabelKit domain; optional custom sender per tenant later |
| `src/lib/server/db/schema.ts` comment on `labels` | Example uses Epsilon imprints | Comment only; no change needed |

Already neutral: `supabase/templates/invite.html` names the inviting label, not Epsilon.

## 2. Gaps for LabelKit, in priority order

### P1. Self-serve signup and org creation
- `src/routes/login/+page.server.ts` uses `shouldCreateUser: false`, so access is invite-only, and there is no route that creates an org.
- Needed: a signup flow that creates the user, the org (name, slug) and an owner membership, then runs onboarding. It also needs abuse controls (email verification is already implicit in magic links; add rate limits).

### P2. Tenant settings: branding, domain, features
- `orgs` has only `name` and `slug`.
- Needed: `display_name`, logo and accent color, custom domain (with Netlify domain + TLS provisioning), and a feature-flags column or table.
- Epsilon gets `display_name = ERMS` on `erms.epsilonrecords.com`, with the A&R and recoupment modules switched on.
- Resolve the tenant from the request host in `hooks.server.ts`, next to the existing active-org logic.

### P3. Plans and billing
- Nothing exists yet. (The `audiokit_label_clients` "billing" fields refer to AudioKit's billing service, not LabelKit plans.)
- Needed: plans, usage limits (tracks, labels, seats), Stripe checkout and webhooks, and enforcing limits at write time.
- Check whether AudioKit's billing service (`audiokit-billing`) can be shared rather than rebuilt.

### P4. Public API
- Today there are only internal and AudioKit machine endpoints.
- Needed: API keys per org (stored hashed, with scopes), versioned REST routes (`/v1/...`) over the same RLS-scoped `locals.db`, outgoing webhooks, OpenAPI docs and a sandbox mode.

### P5. Distribution, statements and payouts (roadmap phase 5)
- Not started. `rights_shares` and `agreements` give the basis for splits.
- Needed:
  - a `DistributionProvider` interface, mirroring the `AudioProvider` pattern, with an adapter for the chosen white-label partner
  - delivery state per store
  - takedowns
  - ingesting sales and streaming reports
  - statements per payee
  - payouts with KYC
- Blocked on choosing a partner (board decision pending).

### P6. Label-only modules for Epsilon
- A&R pipeline and recoupment of advances, behind feature flags (P2). They can be offered later as add-ons.

## 3. Risks and open questions

- **Public repo.** Required by Netlify's free plan (earlier decision). For a commercial SaaS, competitors can read the code. Going private means a paid plan, which needs board approval.
- **Conflict of interest.** Any support or admin tool must not give label staff access to other tenants' data. Keep cross-tenant access out of the app, and audit it.
- **Domain.** LabelKit's domain is undecided. Placeholders: the app domain and the auth email sender.
- **Shared AudioKit quota.** See section 1. Fix this before the first outside tenant.

## Suggested order

P1 → P2 → fix the AudioKit fallback → P3 → P4 → P5 (after the partner decision) → P6.
