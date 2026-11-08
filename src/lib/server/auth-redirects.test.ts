import { describe, expect, it } from 'vitest';
import { authRedirectPatch } from '../../../scripts/auth-redirects.mjs';

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
			site_url: 'https://erms.epsilonrecords.com',
			uri_allow_list: `${uri_allow_list},https://erms.epsilonrecords.com/auth/callback`
		});
	});

	it('is idempotent after the reviewed configuration is applied', () => {
		expect(
			authRedirectPatch({
				site_url: 'https://erms.epsilonrecords.com/',
				uri_allow_list: 'https://erms.epsilonrecords.com/auth/callback'
			})
		).toEqual({});
	});

	it('requires the exact production callback, even with another host or path allowed', () => {
		expect(
			authRedirectPatch({
				site_url: 'https://erms.epsilonrecords.com',
				uri_allow_list:
					' https://erms.epsilonrecords.com/other ,https://other.example/auth/callback'
			})
		).toEqual({
			uri_allow_list:
				'https://erms.epsilonrecords.com/other,https://other.example/auth/callback,https://erms.epsilonrecords.com/auth/callback'
		});
	});
});
