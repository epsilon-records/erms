import { describe, expect, it } from 'vitest';
import { FEATURES, featuresFor, requireFeature, type FlagSource } from './features.js';

const fixed = (on: Record<string, boolean | undefined>): FlagSource => ({
	isEnabled: async (flag) => on[flag]
});

describe('featuresFor', () => {
	it('uses defaults when there is no flag source (keys not set)', async () => {
		expect(await featuresFor(null, 'o1')).toEqual({ ar: false, recoupment: false });
	});

	it('uses the flag value when the source answers', async () => {
		const f = await featuresFor(fixed({ 'labelkit-ar': true }), 'o1');
		expect(f.ar).toBe(true);
		expect(f.recoupment).toBe(FEATURES.recoupment.default);
	});

	it('falls back to the default when the source has no answer or throws', async () => {
		const throwing: FlagSource = {
			isEnabled: async () => {
				throw new Error('PostHog down');
			}
		};
		expect(await featuresFor(throwing, 'o1')).toEqual({ ar: false, recoupment: false });
		expect(await featuresFor(fixed({}), 'o1')).toEqual({ ar: false, recoupment: false });
	});

	it('passes the org to the source', async () => {
		const seen: string[] = [];
		await featuresFor({ isEnabled: async (_f, org) => (seen.push(org), true) }, 'org-42');
		expect(new Set(seen)).toEqual(new Set(['org-42']));
	});
});

describe('requireFeature', () => {
	it('404s when the feature is off', async () => {
		await expect(requireFeature(fixed({}), 'o1', 'ar')).rejects.toMatchObject({ status: 404 });
	});

	it('404s without an org', async () => {
		await expect(
			requireFeature(fixed({ 'labelkit-ar': true }), undefined, 'ar')
		).rejects.toMatchObject({
			status: 404
		});
	});

	it('passes when the feature is on', async () => {
		await expect(
			requireFeature(fixed({ 'labelkit-ar': true }), 'o1', 'ar')
		).resolves.toBeUndefined();
	});
});
