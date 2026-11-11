/**
 * Which domain sends an auth email (decision 0027, EPSILON-147).
 *
 * - Epsilon's staff get mail from `auth.epsilonrecords.com`; everyone else, and anyone with no
 *   membership yet (a new signup), from `auth.labelkit.co`.
 * - **The org the email is about wins when it is known.** Today that is only an invite: the
 *   members page records the inviting org's id in the invite (`invited_org_id`), so an invite to
 *   Epsilon gets Epsilon's sender even though the address has no account or membership yet, and an
 *   invite to another label gets LabelKit's even if the person is already Epsilon staff.
 * - **Otherwise memberships decide.** Epsilon's sender whenever Epsilon is one of the account's
 *   orgs, even if it also belongs to other labels (Nate's decision on EPSILON-147, labelkit#73).
 *   The rule is per recipient, so the other label's people never see Epsilon's sender.
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
	return input.memberOrgIds.some((id) => id.toLowerCase() === epsilon) ? 'epsilon' : 'labelkit';
}
