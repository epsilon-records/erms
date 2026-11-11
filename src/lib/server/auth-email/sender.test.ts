import { describe, expect, it } from 'vitest';
import { chooseSender, SENDERS } from './sender';

const EPSILON = '019a0000-0000-7000-8000-00000000e951';
const OTHER = '019a0000-0000-7000-8000-0000000000b2';
const THIRD = '019a0000-0000-7000-8000-0000000000c3';

const pick = (actionType: string, memberOrgIds: string[], invitedOrgId: string | null = null) =>
	chooseSender({ actionType, memberOrgIds, invitedOrgId, epsilonOrgId: EPSILON });

describe('sign-in email sender (decision 0027)', () => {
	it('sends Epsilon staff mail from auth.epsilonrecords.com', () => {
		expect(pick('magiclink', [EPSILON])).toBe('epsilon');
		expect(SENDERS.epsilon.from).toMatch(/@auth\.epsilonrecords\.com>$/);
	});

	it('sends everyone else, and anyone with no membership, mail from auth.labelkit.co', () => {
		expect(pick('magiclink', [OTHER])).toBe('labelkit');
		expect(pick('magiclink', [])).toBe('labelkit');
		expect(pick('signup', [])).toBe('labelkit');
		expect(SENDERS.labelkit.from).toMatch(/@auth\.labelkit\.co>$/);
	});

	it('uses auth.labelkit.co for a sign-in by someone in Epsilon and another org', () => {
		expect(pick('magiclink', [EPSILON, OTHER])).toBe('labelkit');
		expect(pick('magiclink', [OTHER, EPSILON, THIRD])).toBe('labelkit');
	});

	it('uses the invite’s org when the email is an invite', () => {
		// A new address invited to Epsilon has no account or membership yet.
		expect(pick('invite', [], EPSILON)).toBe('epsilon');
		expect(pick('invite', [], OTHER)).toBe('labelkit');
		// Epsilon staff invited to another label hear from that label's side.
		expect(pick('invite', [EPSILON], OTHER)).toBe('labelkit');
		expect(pick('invite', [OTHER], EPSILON.toUpperCase())).toBe('epsilon');
	});

	it('ignores invited_org_id on anything but an invite (users can edit their own metadata)', () => {
		expect(pick('magiclink', [OTHER], EPSILON)).toBe('labelkit');
		expect(pick('magiclink', [], EPSILON)).toBe('labelkit');
		expect(pick('email_change', [OTHER], EPSILON)).toBe('labelkit');
	});

	it('falls back to memberships for an invite that carries no org id', () => {
		expect(pick('invite', [EPSILON], null)).toBe('epsilon');
		expect(pick('invite', [], null)).toBe('labelkit');
	});

	it('compares org ids case-insensitively and ignores duplicates', () => {
		expect(pick('magiclink', [EPSILON.toUpperCase(), EPSILON])).toBe('epsilon');
	});
});
