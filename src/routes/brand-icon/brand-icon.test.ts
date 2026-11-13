import { describe, expect, it, vi } from 'vitest';
import { iconVersion } from '#lib/server/branding.js';

const cached = vi.hoisted(() => ({ icon: null as Buffer | null }));
vi.mock('#lib/server/branding.js', async (orig) => ({
	...(await orig<typeof import('#lib/server/branding.js')>()),
	cachedBrandIcon: () => cached.icon
}));
const { GET } = await import('./+server');

const OLD = Buffer.from('old icon bytes');
const NEW = Buffer.from('new icon bytes');

function get(v: string | null, brandVersion: string | null) {
	const url = new URL('https://catalogue.example.com/brand-icon');
	if (v) url.searchParams.set('v', v);
	return GET({ url, locals: { brand: { favicon: brandVersion } } } as never) as Response;
}

describe('/brand-icon', () => {
	it('caches for a year when the bytes match the requested version', () => {
		cached.icon = OLD;
		const res = get(iconVersion(OLD), iconVersion(OLD));
		expect(res.headers.get('cache-control')).toContain('immutable');
	});

	it('does not pin new bytes under the old version URL', () => {
		// The hook resolved the old brand; an owner saved a new icon before the bytes were read.
		cached.icon = NEW;
		const res = get(iconVersion(OLD), iconVersion(OLD));
		expect(res.headers.get('cache-control')).toBe('public, max-age=300');
	});

	it('404s for a label with no icon', () => {
		cached.icon = null;
		expect(() => get(null, null)).toThrow();
	});
});
