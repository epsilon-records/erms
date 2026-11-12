import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';

/**
 * The forms moved to the shared components (EPSILON-166) still post what their server actions
 * read, and still say which control an error belongs to. Server-rendered without a database: the
 * actions themselves are covered by each route's own tests.
 */

const state = vi.hoisted(() => ({
	page: { url: new URL('https://labelkit.co/'), data: {} }
}));
vi.mock('$app/state', () => state);

const { default: LoginPage } = await import('../../../routes/login/+page.svelte');
const { default: MembersPage } = await import('../../../routes/members/+page.svelte');
const { default: ApiKeysPage } = await import('../../../routes/org/api-keys/+page.svelte');

const html = (component: unknown, props: Record<string, unknown>) =>
	render(component as never, { props: props as never }).body;

/** Every <button> in the markup, as its opening tag. */
const buttons = (body: string) => body.match(/<button\b[^>]*>/g) ?? [];
const tagWithId = (body: string, id: string) =>
	body.match(new RegExp(`<(input|select)\\b[^>]*\\bid="${id}"[^>]*>`))?.[0] ?? '';

/** The shared Button defaults to type="button"; a form's own buttons must still submit. */
function expectSubmitButtons(body: string) {
	const tags = buttons(body).filter((b) => b.includes('data-slot="button"'));
	expect(tags.length).toBeGreaterThan(0);
	for (const tag of tags) expect(tag).toContain('type="submit"');
}

describe('login form', () => {
	it('posts email from a labelled input with a submit button', () => {
		state.page.url = new URL('https://labelkit.co/login');
		const body = html(LoginPage, { data: { signupOpen: false }, form: null });
		expect(body).toMatch(/<label[^>]*for="email"/);
		const input = tagWithId(body, 'email');
		expect(input).toContain('name="email"');
		expect(input).toContain('type="email"');
		expect(input).toContain('required');
		expect(input).not.toContain(' aria-invalid=');
		expectSubmitButtons(body);
	});

	it('ties an error to the email input', () => {
		const body = html(LoginPage, {
			data: { signupOpen: false },
			form: { error: 'Enter a valid email address.' }
		});
		const input = tagWithId(body, 'email');
		expect(input).toContain('aria-invalid="true"');
		expect(input).toContain('aria-describedby="login-error"');
		expect(body).toMatch(/id="login-error"[^>]*role="alert"[^>]*>Enter a valid email address\./);
	});
});

const members = {
	orgName: 'Test Label',
	me: 'u1',
	invitesOn: true,
	members: [
		{ userId: 'u1', email: 'owner@example.com', role: 'owner', state: 'onboarded', since: 'x' },
		{ userId: 'u2', email: 'viewer@example.com', role: 'viewer', state: 'invited', since: 'x' }
	]
};

describe('members forms', () => {
	it('keeps the field names the actions read, and submits', () => {
		const body = html(MembersPage, { data: members, form: null });
		expect(tagWithId(body, 'role-u2')).toContain('name="role"');
		expect(body).toMatch(/<label[^>]*for="role-u2"/);
		expect(tagWithId(body, 'email')).toContain('name="email"');
		expect(tagWithId(body, 'role')).toContain('name="role"');
		expect(body).toMatch(/<label[^>]*for="email"/);
		expect(body).toMatch(/<label[^>]*for="role"/);
		// The last owner's role can't change.
		expect(tagWithId(body, 'role-u1')).toContain('disabled');
		expectSubmitButtons(body);
	});

	it('shows an invite error on its field and a form error under the form', () => {
		const body = html(MembersPage, {
			data: members,
			form: {
				action: 'invite',
				ok: false,
				errors: { email: 'Enter an email address.', form: 'Seat limit reached.' },
				values: { email: 'nope', role: 'viewer' }
			}
		});
		const email = tagWithId(body, 'email');
		expect(email).toContain('aria-invalid="true"');
		expect(email).toContain('aria-describedby="email-error"');
		expect(email).toContain('value="nope"');
		expect(body).toMatch(/id="email-error">(<!--[^>]*-->)*Enter an email address\./);
		expect(tagWithId(body, 'role')).not.toContain(' aria-invalid=');
		expect(body).toMatch(/class="alert error" role="alert">Seat limit reached\./);
		expect(body).not.toContain('email: Enter');
	});
});

describe('API key form', () => {
	const data = { orgName: 'Test Label', keys: [], scopes: ['catalog:read', 'analysis:write'] };

	it('posts a name and the checked scopes', () => {
		const body = html(ApiKeysPage, { data, form: null });
		expect(tagWithId(body, 'key-name')).toContain('name="name"');
		expect(body).toMatch(/<label[^>]*for="key-name"/);
		// Each scope is a labelled checkbox; the checked one carries the value the action reads.
		expect(body).toMatch(/<button[^>]*id="scope-catalog:read"[^>]*role="checkbox"/);
		expect(body).toMatch(/<label[^>]*for="scope-analysis:write"/);
		// Bits UI's hidden checkbox submits name=value only while checked, like a native one.
		expect(body).toMatch(
			/<input type="checkbox" checked="" name="scopes"[^>]*value="catalog:read"/
		);
		expect(body).toMatch(/<input type="checkbox" name="scopes"[^>]*value="analysis:write"/);
		expectSubmitButtons(body);
	});

	it('keeps the name and points at the error after a refused create', () => {
		const body = html(ApiKeysPage, { data, form: { error: 'Too many keys.', name: 'Sync' } });
		const input = tagWithId(body, 'key-name');
		expect(input).toContain('value="Sync"');
		expect(input).toContain('aria-describedby="create-error"');
	});
});
