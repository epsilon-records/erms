import { describe, expect, it } from 'vitest';
import { authRedirectPatch } from '../../../scripts/auth-redirects.mjs';

const LABELKIT = 'https://labelkit.co/auth/callback';
const ERMS = 'https://erms.epsilonrecords.com/auth/callback';

describe('published-site Auth configuration', () => {
	it('repairs the observed old-host config without dropping preview or legacy URLs', () => {
		const uri_allow_list =
			'https://epsilon-erms.netlify.app/auth/callback,https://epsilon-erms.netlify.app/**,https://*--epsilon-erms.netlify.app/**';
		expect(
			authRedirectPatch({
				site_url: 'https://epsilon-erms.netlify.app/',
				uri_allow_list,
				smtp_pass: 'must-never-appear-in-the-patch'
			})
		).toEqual({
			site_url: 'https://labelkit.co',
			uri_allow_list: `${uri_allow_list},${LABELKIT},${ERMS}`
		});
	});

	it('moves the Site URL to labelkit.co and keeps the ERMS callback (EPSILON-134)', () => {
		expect(
			authRedirectPatch({ site_url: 'https://erms.epsilonrecords.com', uri_allow_list: ERMS })
		).toEqual({ site_url: 'https://labelkit.co', uri_allow_list: `${ERMS},${LABELKIT}` });
	});

	it('is idempotent after the reviewed configuration is applied', () => {
		expect(
			authRedirectPatch({
				site_url: 'https://labelkit.co/',
				uri_allow_list: `${LABELKIT},${ERMS},https://labelkit.co/**`
			})
		).toEqual({});
	});

	it('requires each exact production callback, even with a wildcard or another path allowed', () => {
		expect(
			authRedirectPatch({
				site_url: 'https://labelkit.co',
				uri_allow_list:
					' https://labelkit.co/** ,https://erms.epsilonrecords.com/other,https://other.example/auth/callback'
			})
		).toEqual({
			uri_allow_list: `https://labelkit.co/**,https://erms.epsilonrecords.com/other,https://other.example/auth/callback,${LABELKIT},${ERMS}`
		});
	});
});
