import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { InviteRefused, supabaseAuthAdmin } from './auth-admin';

vi.mock('$app/env/public', () => ({ PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }));
vi.mock('$app/env/private', () => ({ SUPABASE_SECRET_KEY: undefined }));

function fake(admin: Record<string, unknown>) {
	return {
		auth: {
			admin: {
				listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
				...admin
			}
		}
	} as unknown as SupabaseClient;
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
		expect(inviteUserByEmail).not.toHaveBeenCalled();
	});

	it('reuses a pending account from another label without resending its stored copy', async () => {
		const pending = {
			id: 'pending',
			email: 'pending@example.test',
			email_confirmed_at: null,
			user_metadata: { invited_org_name: 'Label A' }
		};
		// Mirrors Auth: inviting an existing unconfirmed user succeeds but sends the
		// stored Label A metadata, not the request's Label B data. Never call this path.
		const sent: unknown[] = [];
		const inviteUserByEmail = vi.fn(async () => {
			sent.push(pending.user_metadata);
			return { data: { user: pending }, error: null };
		});
		const listUsers = vi.fn().mockResolvedValue({ data: { users: [pending] }, error: null });
		const out = await supabaseAuthAdmin(fake({ inviteUserByEmail, listUsers })).invite(
			'pending@example.test',
			'Label B'
		);
		expect(out).toEqual({ userId: 'pending', emailed: false });
		expect(inviteUserByEmail).not.toHaveBeenCalled();
		expect(sent).toEqual([]);
		expect(pending.user_metadata).toEqual({ invited_org_name: 'Label A' });
	});

	it('does not send when account lookup fails or its scan is incomplete', async () => {
		const inviteUserByEmail = vi.fn();
		const listUsers = vi
			.fn()
			.mockResolvedValue({ data: { users: [] }, error: new Error('unavailable') });
		const admin = supabaseAuthAdmin(fake({ inviteUserByEmail, listUsers }));
		await expect(admin.invite('a@example.test', 'Label B')).rejects.toThrow('unavailable');
		listUsers.mockResolvedValue({
			data: { users: Array.from({ length: 1000 }, () => ({ email: 'other@example.test' })) },
			error: null
		});
		await expect(admin.invite('a@example.test', 'Label B')).rejects.toThrow('scan exceeded');
		expect(inviteUserByEmail).not.toHaveBeenCalled();
	});

	it('leaves failed or missing member lookups unknown', async () => {
		const getUserById = vi
			.fn()
			.mockResolvedValue({ data: { user: null }, error: new Error('unavailable') });
		expect(await supabaseAuthAdmin(fake({ getUserById })).accounts(['a'])).toEqual(new Map());
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
