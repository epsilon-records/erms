# Notes for agents

- Decisions about ERMS's scope, stack and hosting live in the private `epsilon-records/knowledge` repo, under `erms/decisions/` and `shared/decisions/`. Read them before proposing changes there; record new decisions there, not here.
- At the start of a session, check the message board for open issues labeled `to:erms`: `gh api "repos/epsilon-records/knowledge/issues?state=open&labels=to:erms"`. The protocol is in that repo's `CLAUDE.md`.
- Routes query through `locals.db` so RLS applies; only `src/hooks.server.ts` and `src/lib/server/db/client.ts` may touch the owner connection, and `owner-access.test.ts` enforces it (see README, Security).
- Before finishing: `pnpm check`, `pnpm lint`, `pnpm test`.
