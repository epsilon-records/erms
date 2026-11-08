# Published-site magic-link redirects

## Incident evidence (2026-11-08, UTC)

A read of production Supabase Auth config found:

- `site_url`: `https://epsilon-erms.netlify.app/`.
- `uri_allow_list`: only `https://epsilon-erms.netlify.app/auth/callback`,
  `https://epsilon-erms.netlify.app/**`, and `https://*--epsilon-erms.netlify.app/**`.
- Magic-link template: `{{ .ConfirmationURL }}`. SMTP: Resend, sender
  `no-reply@auth.epsilonrecords.com`; OTP lifetime: 3600 seconds.

The published Netlify deploy was `3a44f0c56b58142caff6d78d46139e0860ef4ab4`.
Bounded production gateway/Auth logs (12:17–12:20) show this sequence:

1. 12:18:17.102: `/auth/v1/otp` returned 200; requested redirect was
   `https://erms.epsilonrecords.com/auth/callback` (SSR client).
2. 12:18:33.704: browser `/auth/v1/verify` returned 303, Auth action `login`;
   the email's redirect target was `https://epsilon-erms.netlify.app/`.
3. 12:18:34.808: SSR `/auth/v1/token?grant_type=refresh_token` returned 400,
   `refresh_token_not_found`, with the old host root as its Auth-log referer.
4. 12:18:40.531: another OTP request returned 429 (37 seconds remained in
   the resend cooldown), now requesting the old host's callback.

No PKCE token exchange appears in that window. These events are a closely timed
sequence, not a request-ID correlation across all four requests. No raw email URL,
one-time credential, email address, IP address or session token is recorded here.

**Confirmed defect:** the requested published-site callback is absent from the
allowlist. Supabase used its old-host root fallback, which bypasses the callback
and changes the cookie origin. The server cannot establish a new session there.
Unauthenticated GETs to both hosts' `/` returned 303 `/login`; both hosts'
`/auth/callback` returned 303 `/login?link=invalid` without a code. The Netlify
hostname served the app directly; it did not redirect to the custom hostname.

**What the evidence does not prove:** the stale refresh token's origin, the user's
exact browser history, or the whole successful session-cookie round trip. A missing
PKCE verifier in a different browser remains a separate limitation, but is not
needed to explain this failure: the observed verification went to the wrong host
and path before a code exchange. The observed first verification succeeded about
16 seconds after the request, so expiry/consumption is not supported as its cause.
A second use of that same link would nevertheless fail; request a fresh link after
repair. There is no evidence requiring a mail-template, SSR-cookie, or Netlify
redirect rewrite.

## Minimal production repair — applied with coordinator authorization

The coordinator authorized this narrow production correction after reviewing the
trace. The following Auth config PATCH was applied (all existing allowed URLs
were retained):

```json
{
	"site_url": "https://erms.epsilonrecords.com",
	"uri_allow_list": "https://epsilon-erms.netlify.app/auth/callback,https://epsilon-erms.netlify.app/**,https://*--epsilon-erms.netlify.app/**,https://erms.epsilonrecords.com/auth/callback"
}
```

Only these two fields were updated through
`PATCH /v1/projects/efalpthvvmvpaikuxymd/config/auth`, then read back exactly.
SMTP, the `ConfirmationURL` template and users were unchanged. This hosted
configuration repair required no app deployment; the code PR remains unmerged.

The previous two URL fields were saved outside the public repo in an owner-only
rollback file (`~/.local/state/erms/auth-redirects-before-2026-11-08.json`, mode 0600).
Rollback means PATCHing that file's `config` object, not the surrounding metadata.

A deliberately nonexistent test token proved redirect selection without sending
mail, consuming a user's link or issuing a session: before the change, `/verify`
returned 303 to the old host's `/` with `otp_expired`; after propagation, at
12:27:51Z, the same probe returned 303 to
`https://erms.epsilonrecords.com/auth/callback` with `otp_expired`. An immediate
post-PATCH probe still used the old settings, so readback alone was insufficient;
the later Auth response proves the running service accepted the callback.

The read-only checker uses a Management API token supplied through the environment;
do not echo that token or print the complete Auth config:

```sh
node scripts/auth-redirects.mjs --plan # current narrow PATCH; never writes
node scripts/auth-redirects.mjs        # exits 1 on drift, 0 after repair
```

The plan preserves existing redirect entries even if they change after this
report; re-read it before applying. Offline regression tests exercise the observed
config, preservation and idempotence. CI runs those and the callback tests as part
of the existing full `pnpm test` on the pinned Supabase stack; it does not need
production management credentials.

## User-confirmed production sign-in

On 2026-11-08, after the URL configuration repair, Nate replied **“Confirmed”**
to the request to verify sign-in with a fresh magic link on the canonical site.
This records user-confirmed successful production sign-in through the requested
fresh-link flow. It does not add independently observed browser, callback, token-grant
or cookie details beyond that confirmation. The agent sent no email and created no
user session to obtain this evidence.

The sign-in confirmation closes the remaining user sign-in proof for this incident.
It is not approval to merge PR 42, which remains open and unmerged. EPSILON-87's
invite/membership acceptance and decision-0022 invite/onboarding proof remain
separate and are not established by this sign-in confirmation.

A different browser/profile/device cannot supply the verifier cookie for this
PKCE flow. If that is a product requirement, use a separately reviewed token-hash
email flow and corresponding callback; do not change the shared production mail
template merely to fix the proven redirect misconfiguration. EPSILON-87's invite
and onboarding proof remains separate and must run once on the published site
under decision 0022.

References: [Supabase redirect URL configuration](https://supabase.com/docs/guides/auth/redirect-urls),
[PKCE flow](https://supabase.com/docs/guides/auth/sessions/pkce-flow),
[SSR session cookies](https://supabase.com/docs/guides/auth/server-side/advanced-guide).
