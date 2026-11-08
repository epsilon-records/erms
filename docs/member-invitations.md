# Owner invitations and member management (EPSILON-87)

## Scope and authorization

`/members` is owner-only for the selected label. It lists memberships, role and
onboarding state, and supports inviting, changing roles and removing members.
Roles available for people are owner, catalog manager, rights admin and viewer.
Existing agent memberships remain visible and removable but are not offered as
human invite/role choices. There is no org provisioning or self-serve signup UI.

All app database access uses `locals.db`. The mutation functions run as invoker
under owner-only RLS; Supabase `anon` and `authenticated` cannot perform these
writes directly. An org-scoped transaction advisory lock serializes member writes,
including concurrent owner demotions/removals. A database trigger refuses removing
the last owner. Cross-org mutation is refused independently of form validation.

Each mutation goes through `withAudit()`; a deferred database trigger checks for
its matching audit entry in the same top-level transaction. Audit inserts stamp
their transaction id server-side, including across nested savepoints. The owner
connection is exempt from the application member guard for maintenance and test
fixture cleanup, as it already bypasses RLS. Application routes never use it.

Legacy memberships without a stored email display their user id. The invite path
records normalized email with the Supabase identity; email is a contact/display
field, never the authorization identity. The app does not enumerate Auth users or
expose generated authentication credentials to the inviting owner.

## Invitation delivery

Inviting uses Supabase Admin `generateLink(type: magiclink)` to obtain a new or
existing user's id and one-time token hash. It sends no mail itself. The server
adds that id to the owner's selected label with the chosen role and null onboarding
state, then sends the invitation via Resend from the same accepted sender,
`ERMS <no-reply@auth.epsilonrecords.com>` (decision 0021). Membership access starts
when the owner invites; signing in reaches the existing first-run onboarding.

The invitation subject and body name the actual selected label. The server renders
escaped per-message copy rather than writing a shared label into user metadata
(which would be wrong for a person invited into multiple labels). Existing users
are supported too; an Auth invite-only endpoint that rejects registered users
would not meet that requirement. Existing Supabase SMTP/sign-in templates remain
unchanged. This PR adds a direct Resend send path for these Supabase-generated
invitation links; it does not configure it in production.

The email targets the canonical callback with a token hash. The callback verifies
it server-side, selects the invited org cookie, and redirects to onboarding. The
hook validates that cookie against the signed-in user's memberships, so changing
the org URL parameter does not grant access. No owner-browser PKCE verifier is
required to open the invitation. Existing ordinary PKCE sign-in is preserved.

Auth link generation occurs inside the org's serialized transaction, after the
owner check and duplicate check. A database failure sends no email. Auth itself is
external: an account may have been created if the later database transaction
fails, but no org membership survives rollback. Membership/audit commit precedes
email delivery; if delivery fails or times out, the UI clearly says the member was
added but delivery was not confirmed. The owner can resend for a member awaiting
onboarding, after checking their inbox; resend creates a fresh link and is audited.
Neither credentials nor link URLs are stored in the audit log or returned to the
owner. There is no background retry or automatic repeated email send.

## Configuration and release gates — not applied

Before a production rollout, review and authorize the migrations and app release.
Set these server-only Netlify variables through the approved secret path:

- `SUPABASE_SECRET_KEY`: the project secret/service-role key, used only for Auth
  link generation, never database access.
- `RESEND_API_KEY`: a send-only key authorized for the existing verified
  `auth.epsilonrecords.com` sender.

No credentials were read, provisioned or changed for this feature. Leaving either
unset disables invitation delivery visibly; role/removal controls still work once
the migration is applied. Never send from a deploy preview: previews may share the
production database (decision 0022). No SMTP/template or Auth URL change is needed.

## One-time published-site verification — pending

Missing input: **one exact throwaway email address controlled by Nate (or an
explicitly authorized tester), and who will open its inbox/link and complete
onboarding**. A controlled alias must have a deliverable mailbox; no address is
assumed. Merge, production migration/deployment, secret configuration and permission
to send this one invitation also remain release gates. Do not run any step below
until authorized; ordinary sign-in confirmation from PR 42 is not invite acceptance.

1. On `https://erms.epsilonrecords.com`, sign in as an owner and select the intended
   label. Record that label and choose viewer for the one test invitation.
2. Open Members and invite the single controlled address once. Confirm the UI
   acknowledges sending, and check the recipient inbox before retrying anything.
3. Confirm sender `auth.epsilonrecords.com`, and that subject/body name that same
   label. Do not copy the credential-bearing link into a report, ticket or log.
4. The controller opens the link. Confirm onboarding names the correct label and
   Viewer role, then finish onboarding and confirm catalogue access.
5. As owner, confirm that membership is onboarded, change its role to rights admin,
   verify the displayed role, then remove the test membership. Confirm access to
   that label stops on the invitee's next request and the owner sees the audit
   entries for invitation, role change and removal.
6. Record the exact outcome once in EPSILON-87. The audit trail stays permanently;
   remove the test membership rather than trying to erase audit rows. Automated
   tests supply cross-org and last-owner proof without risky live owner removal.

## Automated validation

CI retains the full pinned Supabase stack job. `members.test.ts` exercises owner
invites, chosen role/onboarding, duplicate protection, viewer/outsider and cross-org
refusal, role/removal audit, last-owner rollback, concurrent demotions, self-removal
with a remaining owner, and direct SQL/API-role audit/RLS boundaries. PostgREST
cases assert membership writes do not change rows, rather than trusting status
codes. Mail and callback tests use mocked HTTP clients only and send no email.

References: [Supabase generateLink](https://supabase.com/docs/reference/javascript/auth-admin-generatelink),
[Supabase server-side email authentication](https://supabase.com/docs/guides/auth/auth-email-passwordless),
[Resend email API](https://resend.com/docs/api-reference/emails/send-email).
