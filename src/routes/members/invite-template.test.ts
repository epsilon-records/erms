import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Supabase's templates are shared by every label and one sender serves them all (decision 0021),
// so the invite must name the recipient's own label and never Epsilon's.
const raw = readFileSync('supabase/templates/invite.html', 'utf8');
const body = raw.replace(/<!--[\s\S]*?-->/g, '');
const config = readFileSync('supabase/config.toml', 'utf8');
const subject =
	/\[auth\.email\.template\.invite\][^[]*?subject = "([^"]*)"/.exec(config)?.[1] ?? '';

describe('invite email copy', () => {
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
