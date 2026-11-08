import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/**
 * The Supabase secret key bypasses RLS. It is read in one module (auth-admin.ts), and that module is
 * used by one route, the members page, for invites only. Widening this list needs a reason in review.
 */
const ALLOWED = new Set(['src/lib/server/auth-admin.ts', 'src/routes/members/+page.server.ts']);

function* files(dir: string): Generator<string> {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		if (statSync(p).isDirectory()) yield* files(p);
		else if (/\.(ts|svelte)$/.test(p) && !p.endsWith('.test.ts')) yield p;
	}
}

it('only the members route uses the Auth admin client', () => {
	const offenders = [...files('src')].filter(
		(p) => !ALLOWED.has(p) && /auth-admin(\.js)?['"]/.test(readFileSync(p, 'utf8'))
	);
	expect(offenders).toEqual([]);
});

it('only auth-admin.ts reads the secret key', () => {
	const offenders = [...files('src')].filter(
		(p) =>
			p !== 'src/lib/server/auth-admin.ts' &&
			p !== 'src/env.ts' &&
			readFileSync(p, 'utf8').includes('SUPABASE_SECRET_KEY')
	);
	expect(offenders).toEqual([]);
});

it('the secret key is never public', () => {
	const env = readFileSync('src/env.ts', 'utf8');
	const block = env.slice(env.indexOf('SUPABASE_SECRET_KEY'), env.indexOf('AUDIO_PROVIDER'));
	expect(block).not.toMatch(/public:\s*true/);
	expect(env).not.toContain('PUBLIC_SUPABASE_SECRET');
});
