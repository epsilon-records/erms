import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InviteRefused, supabaseAuthAdmin } from './auth-admin';

vi.mock('$app/env/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$app/env/private', () => ({ SUPABASE_SECRET_KEY: undefined }));

function fake(admin: Record<string, unknown>) {
	return { auth: { admin } } as unknown as SupabaseClient;
}

describe('Auth admin (invites)', () => {
	it('invites a new address with the label name for the email copy', async () => {
		const inviteUserByEmail = vi
			.fn()
			.mockResolvedValue({ data: { user: { id: 'new-user' } }, error: null });
		const out = await supabaseAuthAdmin(fake({ inviteUserByEmail })).invite(
			'  Someone@Example.TEST ',
			'Label A'
		);
		expect(out).toEqual({ userId: 'new-user', emailed: true });
		expect(inviteUserByEmail).toHaveBeenCalledWith('someone@example.test', {
			data: { invited_org_name: 'Label A' }
		});
	});

	it('finds an existing account without sending anything', async () => {
		const inviteUserByEmail = vi.fn().mockResolvedValue({
			data: { user: null },
			error: { status: 422, code: 'email_exists' }
		});
		const listUsers = vi.fn().mockResolvedValue({
			data: {
				users: [
					{ id: 'other', email: 'x@example.test' },
					{ id: 'known', email: 'Known@Example.test' }
				]
			},
			error: null
		});
		const out = await supabaseAuthAdmin(fake({ inviteUserByEmail, listUsers })).invite(
			'known@example.test',
			'Label A'
		);
		expect(out).toEqual({ userId: 'known', emailed: false });
	});

	it('turns a rate limit into a message the owner can act on', async () => {
		const inviteUserByEmail = vi
			.fn()
			.mockResolvedValue({ data: { user: null }, error: { status: 429 } });
		await expect(
			supabaseAuthAdmin(fake({ inviteUserByEmail })).invite('a@example.test', 'Label A')
		).rejects.toBeInstanceOf(InviteRefused);
	});

	it('reads address and last sign-in per member', async () => {
		const getUserById = vi.fn(async (id: string) => ({
			data: {
				user: { id, email: `${id}@example.test`, last_sign_in_at: id === 'a' ? '2026-01-01' : null }
			}
		}));
		const out = await supabaseAuthAdmin(fake({ getUserById })).accounts(['a', 'b']);
		expect(out.get('a')).toEqual({ email: 'a@example.test', lastSignInAt: '2026-01-01' });
		expect(out.get('b')).toEqual({ email: 'b@example.test', lastSignInAt: null });
	});
});
