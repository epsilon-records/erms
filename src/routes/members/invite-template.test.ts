import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Supabase's templates are shared by every label and one sender serves them all (decision 0021),
// so the invite must name the recipient's own label and never Epsilon's.
const raw = readFileSync('supabase/templates/invite.html', 'utf8');
// The template opens with one notes comment for maintainers. Take what follows it rather than
// stripping comments with a pattern: the test asserts that shape instead of sanitising markup.
const head = raw.indexOf('-->');
const body = raw.slice(head + '-->'.length);
const config = readFileSync('supabase/config.toml', 'utf8');
const subject =
	/\[auth\.email\.template\.invite\][^[]*?subject = "([^"]*)"/.exec(config)?.[1] ?? '';

describe('invite email copy', () => {
	it('has exactly one comment, at the top, so everything after it is what recipients see', () => {
		expect(raw.trimStart().startsWith('<!--')).toBe(true);
		expect(head).toBeGreaterThan(0);
		expect(raw.split('<!--').length - 1).toBe(1);
		expect(body).not.toContain('<!--');
	});

	it('names the invited label in the subject and body', () => {
		expect(subject).toContain('{{ .Data.invited_org_name }}');
		expect(body).toContain('{{ .Data.invited_org_name }}');
	});

	it('never hard-codes Epsilon', () => {
		expect(`${subject}\n${body}`).not.toMatch(/epsilon/i);
	});

	it('links to /auth/confirm with the token hash, not a PKCE confirmation URL', () => {
		expect(body).toContain(
			'{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&amp;type=invite'
		);
		expect(raw).not.toContain('.ConfirmationURL');
	});

	it('uses the key the invite sends', () => {
		expect(readFileSync('src/lib/server/auth-admin.ts', 'utf8')).toContain(
			'invited_org_name: orgName'
		);
	});
});
