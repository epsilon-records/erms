import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * Files allowed to touch the owner connection. Machine endpoints authenticate with the worker
 * bearer secret or AudioKit's webhook signature before accessing cross-org job state.
 */
const ALLOWED = new Set([
	'src/hooks.server.ts',
	'src/lib/server/db/client.ts',
	'src/routes/api/audiokit/worker/+server.ts',
	'src/routes/api/audiokit/reconcile/+server.ts',
	'src/routes/api/audiokit/webhook/+server.ts',
	'src/routes/api/audiokit/webhook/[client_id]/+server.ts',
	// Deletes closed labels after their grace period (migration 0027); worker bearer secret.
	'src/routes/api/internal/purge-orgs/+server.ts',
	// Issues a label's AudioKit client; no other role can touch the credentials table.
	'src/routes/org/audiokit-client/+server.ts'
]);

function* files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) yield* files(p);
		else if (/\.(ts|svelte)$/.test(p) && !p.endsWith('.test.ts')) yield p;
	}
}

it('only the request hook uses the owner connection', () => {
	const offenders = [...files('src')].filter(
		(p) => !ALLOWED.has(p) && /db\/client(\.js)?['"]/.test(readFileSync(p, 'utf8'))
	);
	expect(offenders).toEqual([]);
});
