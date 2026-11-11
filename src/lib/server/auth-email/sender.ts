/**
 * Which domain sends an auth email (decision 0027, EPSILON-147).
 *
 * - Epsilon's staff get mail from `auth.epsilonrecords.com`; everyone else, and anyone with no
 *   membership yet (a new signup), from `auth.labelkit.co`.
 * - **The org the email is about wins when it is known.** Today that is only an invite: the
 *   members page records the inviting org's id in the invite (`invited_org_id`), so an invite to
 *   Epsilon gets Epsilon's sender even though the address has no account or membership yet, and an
 *   invite to another label gets LabelKit's even if the person is already Epsilon staff.
 * - **Otherwise memberships decide.** Epsilon's sender only when Epsilon is the account's one and
 *   only org. Someone in Epsilon and another label gets `auth.labelkit.co` for sign-in links: a
 *   sign-in link is not about one label, and the neutral sender is right for both.
 * - `invited_org_id` lives in user metadata, which a signed-in user can change on their own
 *   account, so it is trusted only for `invite` emails. Those are sent by the Auth admin API alone,
 *   at the moment the account is created with that metadata.
 */

export type SenderId = 'epsilon' | 'labelkit';

export type Sender = {
	id: SenderId;
	domain: string;
	from: string;
	/** What the copy calls the app. */
	product: string;
};

export const SENDERS: Record<SenderId, Sender> = {
	epsilon: {
		id: 'epsilon',
		domain: 'auth.epsilonrecords.com',
		from: 'Epsilon Records <no-reply@auth.epsilonrecords.com>',
		product: 'ERMS'
	},
	labelkit: {
		id: 'labelkit',
		domain: 'auth.labelkit.co',
		from: 'LabelKit <no-reply@auth.labelkit.co>',
		product: 'LabelKit'
	}
};

export type SenderInput = {
	actionType: string;
	/** `user_metadata.invited_org_id`, if any. */
	invitedOrgId: string | null;
	/** Every org the account belongs to. */
	memberOrgIds: readonly string[];
	epsilonOrgId: string;
};

export function chooseSender(input: SenderInput): SenderId {
	const epsilon = input.epsilonOrgId.toLowerCase();
	if (input.actionType === 'invite' && input.invitedOrgId) {
		return input.invitedOrgId.toLowerCase() === epsilon ? 'epsilon' : 'labelkit';
	}
	const orgs = new Set(input.memberOrgIds.map((id) => id.toLowerCase()));
	return orgs.size === 1 && orgs.has(epsilon) ? 'epsilon' : 'labelkit';
}
