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
const { default: ReleaseEditPage } =
	await import('../../../routes/releases/[id]/edit/+page.svelte');
const { default: RecordingPage } = await import('../../../routes/recordings/[id]/+page.svelte');
const { analysisEmpty } = await import('../fixtures.stories-data.js');
const { default: Credits } = await import('../Credits.svelte');
const { default: Ownership } = await import('../Ownership.svelte');
const { default: CompositionsPage } = await import('../../../routes/compositions/+page.svelte');
const { default: CompositionPage } = await import('../../../routes/compositions/[id]/+page.svelte');
const { default: AgreementsPage } = await import('../../../routes/rights/agreements/+page.svelte');
const { default: ConsentsPage } = await import('../../../routes/rights/consents/+page.svelte');
const { default: ArtistPage } = await import('../../../routes/artists/[id]/+page.svelte');
const { default: ClosePage } = await import('../../../routes/org/close/+page.svelte');
const { default: ClosedPage } = await import('../../../routes/org/closed/+page.svelte');

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

	it("server-renders each member's current role as selected", () => {
		// A role form submitted before hydration (or without JavaScript) must post the current role,
		// not the first option, "owner".
		const body = html(MembersPage, { data: members, form: null });
		const select = (id: string) =>
			body.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`))?.[0] ?? '';
		const selected = (id: string) =>
			[...select(id).matchAll(/<option[^>]*value="([^"]+)"[^>]*selected/g)].map((m) => m[1]);
		expect(selected('role-u2')).toEqual(['viewer']);
		expect(selected('role-u1')).toEqual(['owner']);
		expect(selected('role')).toEqual(['viewer']);
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
		// Each scope is a native checkbox (works before hydration); the checked one submits its value.
		expect(body).toMatch(
			/<input[^>]*type="checkbox"[^>]*id="scope-catalog:read"[^>]*name="scopes"[^>]*value="catalog:read"/
		);
		expect(tagWithId(body, 'scope-catalog:read')).toContain(' checked=""');
		expect(tagWithId(body, 'scope-analysis:write')).not.toContain(' checked=""');
		expect(body).toMatch(
			/<input[^>]*type="checkbox"[^>]*id="scope-analysis:write"[^>]*name="scopes"/
		);
		expect(body).not.toMatch(/role="checkbox"/);
		expectSubmitButtons(body);
	});

	it('keeps the name and points at the error after a refused create', () => {
		const body = html(ApiKeysPage, { data, form: { error: 'Too many keys.', name: 'Sync' } });
		const input = tagWithId(body, 'key-name');
		expect(input).toContain('value="Sync"');
		expect(input).toContain('aria-describedby="create-error"');
	});
});

/** A save form's controls post the names its action reads; a refused save keeps what was typed. */
function expectFields(body: string, names: string[]) {
	for (const name of names) {
		expect(body, name).toMatch(new RegExp(`<label[^>]*for="${name}"`));
		expect(tagWithId(body, name), name).toContain(`name="${name}"`);
		expect(tagWithId(body, name), name).not.toContain(' aria-invalid=');
	}
}

describe('release edit form', () => {
	const release = {
		id: '00000000-0000-4000-8000-000000000001',
		title: 'Night Drive',
		versionTitle: null,
		type: 'ep',
		releaseDate: '2026-03-06',
		labelId: 'l2',
		catalogNumber: 'EPS042',
		upc: '196000000017',
		genre: 'Electronic',
		subgenre: 'Techno',
		updatedAt: new Date('2026-11-01T10:00:00Z'),
		artists: []
	};
	const data = {
		release,
		labels: [
			{ id: 'l1', name: 'Epsilon Records' },
			{ id: 'l2', name: 'Epsilon Deep' }
		],
		can: { approve: false }
	};
	const FIELDS = [
		'title',
		'versionTitle',
		'type',
		'releaseDate',
		'labelId',
		'catalogNumber',
		'upc',
		'genre',
		'subgenre'
	];

	it('posts every field from a labelled control, with the stored values selected', () => {
		const body = html(ReleaseEditPage, { data, form: null });
		expectFields(body, FIELDS);
		expect(body).toMatch(/<input[^>]*type="hidden"[^>]*name="updatedAt"/);
		expect(tagWithId(body, 'title')).toContain('value="Night Drive"');
		expect(body).toMatch(/<option[^>]*value="ep"[^>]*selected/);
		expect(body).toMatch(/<option[^>]*value="l2"[^>]*selected/);
		expect(body).not.toMatch(/<option[^>]*value="l1"[^>]*selected/);
		expectSubmitButtons(body);
	});

	it('puts a field error under its field and keeps what was typed', () => {
		const form = {
			action: 'save',
			ok: false,
			errors: { upc: 'UPC already used by "Other"', form: 'Someone changed this record.' },
			values: { title: 'Night Drive II', upc: '196000000024', type: 'album', labelId: 'l1' }
		};
		const body = html(ReleaseEditPage, { data, form });
		const upc = tagWithId(body, 'upc');
		expect(upc).toContain('aria-invalid="true"');
		expect(upc).toContain('aria-describedby="upc-error"');
		expect(upc).toContain('value="196000000024"');
		expect(body).toMatch(
			/role="alert"[^>]*id="upc-error"[^>]*>(<!--[^>]*-->)*UPC already used by (&quot;|")Other/
		);
		expect(tagWithId(body, 'title')).toContain('value="Night Drive II"');
		expect(tagWithId(body, 'title')).not.toContain(' aria-invalid=');
		expect(body).toMatch(/<option[^>]*value="album"[^>]*selected/);
		// An error that names no field stays under the form, once.
		expect(body.match(/Someone changed this record\./g)).toHaveLength(1);
	});
});

describe('recording forms', () => {
	const recording = {
		id: '00000000-0000-4000-8000-000000000002',
		title: 'Night Drive',
		versionTitle: 'Extended Mix',
		isrc: 'NLA1G2600001',
		durationMs: 395_000,
		genre: 'Electronic',
		subgenre: 'Techno',
		updatedAt: new Date('2026-11-01T10:00:00Z')
	};
	const data = {
		recording,
		releases: [],
		credits: [],
		compositions: [],
		compositionChoices: [{ id: 'c1', title: 'Night Drive', iswc: 'T-123.456.789-0' }],
		masters: [],
		analysis: analysisEmpty,
		ownership: null,
		holders: [],
		previewPlayable: false,
		uploadsEnabled: false,
		can: {
			uploadMaster: false,
			deleteMaster: false,
			edit: true,
			approve: false,
			rights: true,
			runAnalysis: false
		}
	};
	const FIELDS = ['title', 'versionTitle', 'isrc', 'duration', 'genre', 'subgenre'];

	it('posts the details from labelled controls', () => {
		const body = html(RecordingPage, { data, form: null });
		expectFields(body, FIELDS);
		expect(tagWithId(body, 'duration')).toContain('value="06:35"');
		expectSubmitButtons(body);
	});

	it('puts a field error under its field', () => {
		const form = {
			action: 'save',
			ok: false,
			errors: { duration: 'Duration must be mm:ss' },
			values: { title: 'Night Drive', isrc: 'NLA1G2600001', duration: '6m35' }
		};
		const body = html(RecordingPage, { data, form });
		const duration = tagWithId(body, 'duration');
		expect(duration).toContain('aria-describedby="duration-error"');
		expect(duration).toContain('value="6m35"');
		expect(body).toMatch(
			/role="alert"[^>]*id="duration-error"[^>]*>(<!--[^>]*-->)*Duration must be mm:ss/
		);
	});

	it('keeps the composition forms posting what their actions read', () => {
		const body = html(RecordingPage, { data, form: null });
		expect(tagWithId(body, 'comp-title')).toContain('name="title"');
		expect(tagWithId(body, 'comp-iswc')).toContain('name="iswc"');
		const link = tagWithId(body, 'comp-link');
		expect(link).toContain('name="compositionId"');
		expect(link).toContain('required');
		expect(body).toMatch(/<option[^>]*value="c1"[^>]*>(<!---->)?Night Drive \(T-123\.456\.789-0\)/);
	});
});

/** The <select> with this id, from its opening tag to its closing tag. */
const selectWithId = (body: string, id: string) =>
	body.match(new RegExp(`<select[^>]*id="${id}"[\\s\\S]*?</select>`))?.[0] ?? '';
const selectedValues = (body: string, id: string) =>
	[...selectWithId(body, id).matchAll(/<option[^>]*value="([^"]*)"[^>]*selected/g)].map(
		(m) => m[1]
	);

describe('credits add form', () => {
	const props = { credits: [], canEdit: true, roles: ['main', 'remixer'] };

	it('posts name and role, and keeps the chosen role after a refusal', () => {
		const body = html(Credits, { ...props, values: { name: 'Ana', role: 'remixer' } });
		expect(tagWithId(body, 'credit-name')).toContain('name="name"');
		expect(tagWithId(body, 'credit-name')).toContain('value="Ana"');
		expect(tagWithId(body, 'credit-role')).toContain('name="role"');
		expect(selectedValues(body, 'credit-role')).toEqual(['remixer']);
		expectSubmitButtons(body);
	});

	it('puts a name error under the name input', () => {
		const body = html(Credits, { ...props, errors: { name: 'Ana already has this credit' } });
		const input = tagWithId(body, 'credit-name');
		expect(input).toContain('aria-invalid="true"');
		expect(input).toContain('aria-describedby="credit-name-error"');
		expect(body).toMatch(
			/role="alert"[^>]*id="credit-name-error"[^>]*>(<!--[^>]*-->)*Ana already has/
		);
	});

	it('shows an error that names no field of the add form under the form', () => {
		const body = html(Credits, { ...props, errors: { partyId: 'Unknown artist' } });
		expect(body).toMatch(/role="alert"[^>]*>Unknown artist/);
		expect(tagWithId(body, 'credit-name')).not.toContain(' aria-invalid=');
	});

	it('shows a role error under the form when there is no role control', () => {
		const body = html(Credits, { ...props, roles: ['main'], errors: { role: 'Pick a role' } });
		expect(body).toMatch(/role="alert"[^>]*>Pick a role/);
	});

	it('sends a single role as a hidden field', () => {
		const body = html(Credits, { ...props, roles: ['main'] });
		expect(body).toMatch(/<input type="hidden" name="role" value="main"/);
		expect(selectWithId(body, 'credit-role')).toBe('');
	});
});

describe('ownership form', () => {
	const groups = [
		{
			territory: 'WW',
			holders: [{ holder: 'p:a1', name: 'Ana', isLabel: false, share: '100' }]
		}
	];
	const options = { labels: [{ id: 'l1', name: 'Epsilon' }], parties: [{ id: 'a1', name: 'Ana' }] };

	it('posts territory and holder/share rows, with the current holder selected in its group', () => {
		const body = html(Ownership, { groups, options, action: 'setMaster' });
		expect(tagWithId(body, 'own-territory')).toContain('name="territory"');
		expect(tagWithId(body, 'holder_0')).toContain('name="holder_0"');
		expect(tagWithId(body, 'share_0')).toContain('name="share_0"');
		expect(tagWithId(body, 'share_0')).toContain('value="100"');
		expect(selectWithId(body, 'holder_0')).toMatch(/<optgroup[^>]*label="Our labels"/);
		expect(selectedValues(body, 'holder_0')).toEqual(['p:a1']);
		expect(selectedValues(body, 'holder_1')).toEqual(['']);
		expectSubmitButtons(body);
	});

	it('ties a territory error to the territory input, not the box under the form', () => {
		const body = html(Ownership, {
			groups,
			options,
			action: 'setMaster',
			errors: { territory: 'Use a two-letter country code' },
			values: { territory: 'XYZ' }
		});
		const input = tagWithId(body, 'own-territory');
		expect(input).toContain('aria-invalid="true"');
		expect(input).toContain('aria-describedby="own-territory-help own-territory-error"');
		expect(body.match(/Use a two-letter country code/g)).toHaveLength(1);
		expect(body).toMatch(/id="own-territory-error"/);
	});
});

describe('compositions forms', () => {
	it('posts a new composition and ties an ISWC error to its input', () => {
		const data = { compositions: [], canWrite: true };
		const form = {
			ok: false,
			errors: { iswc: 'ISWC already used' },
			values: { title: 'Dawn', iswc: 'x' }
		};
		const body = html(CompositionsPage, { data, form });
		expect(tagWithId(body, 'title')).toContain('value="Dawn"');
		expect(tagWithId(body, 'iswc')).toContain('aria-describedby="iswc-error"');
		expect(body).toMatch(/role="alert"[^>]*id="iswc-error"[^>]*>(<!--[^>]*-->)*ISWC already used/);
		expectSubmitButtons(body);
	});

	const composition = {
		id: '00000000-0000-4000-8000-000000000003',
		title: 'Dawn',
		iswc: null,
		updatedAt: new Date('2026-11-01T10:00:00Z')
	};
	const data = {
		composition,
		recordings: [],
		recordingChoices: [{ id: 'r1', title: 'Dawn', versionTitle: null, isrc: 'NLA1G2600001' }],
		writers: [{ partyId: 'a1', name: 'Ana', role: 'composer', share: '100' }],
		options: { labels: [], parties: [{ id: 'a1', name: 'Ana' }] },
		publishing: null,
		can: { write: true }
	};

	it('keeps the detail, link and writer forms posting what their actions read', () => {
		const body = html(CompositionPage, { data, form: null });
		expectFields(body, ['title', 'iswc']);
		expect(tagWithId(body, 'link-rec')).toContain('name="recordingId"');
		expect(tagWithId(body, 'writer_0')).toContain('name="writer_0"');
		expect(selectedValues(body, 'writer_0')).toEqual(['a1']);
		expect(selectedValues(body, 'role_0')).toEqual(['composer']);
		expect(tagWithId(body, 'wshare_0')).toContain('name="share_0"');
		expectSubmitButtons(body);
	});
});

describe('rights forms', () => {
	const options = {
		labels: [
			{ id: 'l1', name: 'Epsilon' },
			{ id: 'l2', name: 'Epsilon Deep' }
		],
		parties: [{ id: 'a1', name: 'Ana' }]
	};
	const AGREEMENT_FIELDS = [
		'title',
		'counterpartyId',
		'labelId',
		'kind',
		'status',
		'signedOn',
		'startsOn',
		'endsOn',
		'territory',
		'notes'
	];

	it('posts every agreement field, defaulting to the first label', () => {
		const body = html(AgreementsPage, { data: { agreements: [], options }, form: null });
		expectFields(body, AGREEMENT_FIELDS);
		expect(selectedValues(body, 'labelId')).toEqual(['l1']);
		expect(selectedValues(body, 'status')).toEqual(['draft']);
		expect(tagWithId(body, 'territory')).toContain('value="WW"');
		expectSubmitButtons(body);
	});

	it('puts an agreement date error under its field and other errors under the form', () => {
		const form = {
			ok: false,
			errors: { endsOn: 'The end date is before the start date', form: 'Try again.' },
			values: { title: 'Deal', labelId: 'l2', endsOn: '2026-01-01' }
		};
		const body = html(AgreementsPage, { data: { agreements: [], options }, form });
		expect(tagWithId(body, 'endsOn')).toContain('aria-describedby="endsOn-error"');
		expect(body).toMatch(/role="alert"[^>]*id="endsOn-error"[^>]*>(<!--[^>]*-->)*The end date/);
		expect(selectedValues(body, 'labelId')).toEqual(['l2']);
		expect(body.match(/Try again\./g)).toHaveLength(1);
	});

	it('posts every consent field', () => {
		const data = { consents: [], agreements: [], options, today: '2026-11-12' };
		const body = html(ConsentsPage, { data, form: null });
		expectFields(body, [
			'partyId',
			'purpose',
			'recordingId',
			'agreementId',
			'grantedOn',
			'expiresOn',
			'notes'
		]);
		expect(tagWithId(body, 'grantedOn')).toContain('value="2026-11-12"');
		expectSubmitButtons(body);
	});

	it('ties a grant error to its field, and the revoke button confirms the removal', () => {
		const consent = {
			id: 'c1',
			partyId: 'a1',
			party: 'Ana',
			purpose: 'stem_separation',
			recordingId: null,
			recording: null,
			recordingVersion: null,
			grantedOn: '2026-01-01',
			expiresOn: null,
			revokedAt: null
		};
		const data = { consents: [consent], agreements: [], options, today: '2026-11-12' };
		const form = {
			action: 'grant',
			ok: false,
			errors: { expiresOn: 'Expiry is before the grant date' },
			values: { partyId: 'a1', expiresOn: '2025-01-01' }
		};
		const body = html(ConsentsPage, { data, form });
		expect(tagWithId(body, 'expiresOn')).toContain('aria-describedby="expiresOn-error"');
		expect(body).toMatch(
			/role="alert"[^>]*id="expiresOn-error"[^>]*>(<!--[^>]*-->)*Expiry is before/
		);
		expect(body).toMatch(
			/<button[^>]*name="removalConfirmed"[^>]*value="yes"[^>]*type="submit"|<button[^>]*type="submit"[^>]*name="removalConfirmed"[^>]*value="yes"/
		);
	});
});

describe('artist, close and closed forms', () => {
	const artist = { party: { displayName: 'Ana' }, releases: [], credits: [] };

	it('ties a rename error to the name input', () => {
		const form = { ok: false, errors: { displayName: 'Name is required' } };
		const body = html(ArtistPage, { data: { artist, can: { edit: true } }, form });
		const input = tagWithId(body, 'displayName');
		expect(input).toContain('name="displayName"');
		expect(input).toContain('aria-describedby="displayName-error"');
		expect(body).toMatch(
			/role="alert"[^>]*id="displayName-error"[^>]*>(<!--[^>]*-->)*Name is required/
		);
		expectSubmitButtons(body);
	});

	it('posts the close confirmation, and disables closing while the plan renews', () => {
		const body = html(ClosePage, { data: { orgName: 'Test Label', renewing: true }, form: null });
		expect(body).toMatch(
			/<label>[\s\S]*Type <strong>Test Label<\/strong>[\s\S]*<input[^>]*name="confirm"[^>]*required/
		);
		const close = buttons(body).find((b) => b.includes('data-slot="button"')) ?? '';
		expect(close).toContain('type="submit"');
		// The attribute, not the `disabled:` style variants in the class list.
		expect(close.replace(/class="[^"]*"/, '')).toMatch(/\bdisabled\b/);
	});

	it('posts the label to switch to', () => {
		const data = {
			orgName: 'Test Label',
			isOwner: false,
			purgeAfter: '2026-12-12',
			others: [
				{ orgId: 'o1', orgName: 'One' },
				{ orgId: 'o2', orgName: 'Two' }
			]
		};
		const body = html(ClosedPage, { data, form: null });
		expect(body).toMatch(/<label>[\s\S]*Switch to another label[\s\S]*<select[^>]*name="orgId"/);
		expect(body).toMatch(/<option[^>]*value="o2"[^>]*>(<!---->)?Two/);
		expectSubmitButtons(body);
	});
});
