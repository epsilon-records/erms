import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Ownership from './Ownership.svelte';

const groups = [
	{
		territory: 'WW',
		holders: [{ holder: 'p:a', name: 'Worldwide holder', isLabel: false, share: '100' }]
	},
	{
		territory: 'NL',
		holders: [{ holder: 'p:b', name: 'Dutch holder', isLabel: false, share: '100' }]
	}
];
const options = {
	labels: [],
	parties: [
		{ id: 'a', name: 'Worldwide holder' },
		{ id: 'b', name: 'Dutch holder' },
		{ id: 'c', name: 'Submitted holder' }
	]
};

function controls(errors: Record<string, string> = {}, values: Record<string, string> = {}) {
	// Server render runs no client effects: these are the controls a no-JS retry actually posts.
	const { body } = render(Ownership, {
		props: { groups, options, action: 'setMaster', errors, values }
	});
	const form = body.match(/<form\b[\s\S]*?<\/form>/)?.[0] ?? '';
	const territory = form.match(/<input\b[^>]*name="territory"[^>]*>/)?.[0] ?? '';
	const holder = form.match(/<select\b[^>]*name="holder_0"[\s\S]*?<\/select>/)?.[0] ?? '';
	const share = form.match(/<input\b[^>]*name="share_0"[^>]*>/)?.[0] ?? '';
	return { form, territory, holder, share };
}

describe('ownership server-rendered retry controls', () => {
	it.each([
		['unconfirmed removal', { form: 'Removal requires confirmation.' }, '100'],
		['invalid share', { shares: 'Shares must total 100%.' }, 'invalid']
	])(
		'retains the selected non-worldwide territory and submitted rows after %s',
		(_name, errors, share) => {
			const result = controls(errors, { territory: 'nl', holder_0: 'p:c', share_0: share });
			expect(result.territory).toContain('value="NL"');
			expect(result.holder).toMatch(/<option\b[^>]*value="p:c"[^>]*selected/);
			expect(result.holder).not.toMatch(/<option\b[^>]*value="p:a"[^>]*selected/);
			expect(result.share).toContain(`value="${share}"`);
			expect(result.form).not.toContain('name="removalConfirmed"');
		}
	);

	it('retains an empty non-worldwide set when clearing ownership was refused', () => {
		const result = controls({ form: 'Removal requires confirmation.' }, { territory: 'NL' });
		expect(result.territory).toContain('value="NL"');
		expect(result.holder).toMatch(/<option\b[^>]*value=""[^>]*selected/);
		expect(result.share).toContain('value=""');
	});

	it('defaults an ordinary edit to persisted worldwide ownership', () => {
		const result = controls({}, { territory: 'NL', holder_0: 'p:c', share_0: '50' });
		expect(result.territory).toContain('value="WW"');
		expect(result.holder).toMatch(/<option\b[^>]*value="p:a"[^>]*selected/);
		expect(result.share).toContain('value="100"');
	});

	it('restores failed values for the default worldwide territory', () => {
		const result = controls(
			{ shares: 'Invalid shares.' },
			{ territory: '', holder_0: 'p:c', share_0: '25' }
		);
		expect(result.territory).toContain('value="WW"');
		expect(result.holder).toMatch(/<option\b[^>]*value="p:c"[^>]*selected/);
		expect(result.share).toContain('value="25"');
	});
});
