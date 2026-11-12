import { describe, expect, it, vi } from 'vitest';
import {
	posthogFlagSource,
	READY_BUDGET_MS,
	REGISTER_BUDGET_MS,
	type FlagClient
} from './posthog-flags.js';

function client(over: Partial<FlagClient> = {}): FlagClient {
	return {
		identifyImmediate: async () => {},
		isLocalEvaluationReady: () => true,
		waitForLocalEvaluationReady: async () => true,
		isFeatureEnabled: async () => true,
		...over
	};
}

describe('posthogFlagSource', () => {
	it('gives no source when the client throws on construction', () => {
		const log = vi.fn();
		const source = posthogFlagSource(() => {
			throw new Error('A project API key ("phc_...") was provided as secretKey');
		}, log);
		expect(source).toBeNull();
		expect(log).toHaveBeenCalledOnce();
	});

	it('evaluates locally for the org once definitions are ready', async () => {
		const isFeatureEnabled = vi.fn(async () => true);
		const source = posthogFlagSource(() => client({ isFeatureEnabled }))!;
		expect(await source.isEnabled('labelkit-ar', 'o1')).toBe(true);
		expect(isFeatureEnabled).toHaveBeenCalledWith('labelkit-ar', 'org_o1', {
			personProperties: { org_id: 'o1' },
			onlyEvaluateLocally: true,
			sendFeatureFlagEvents: false,
			disableGeoip: true
		});
	});

	it('answers nothing (default) when definitions are not ready within the budget', async () => {
		const waitForLocalEvaluationReady = vi.fn(async () => false);
		const isFeatureEnabled = vi.fn(async () => true);
		const source = posthogFlagSource(() =>
			client({ isLocalEvaluationReady: () => false, waitForLocalEvaluationReady, isFeatureEnabled })
		)!;
		expect(await source.isEnabled('labelkit-ar', 'o1')).toBeUndefined();
		expect(waitForLocalEvaluationReady).toHaveBeenCalledWith(READY_BUDGET_MS);
		expect(isFeatureEnabled).not.toHaveBeenCalled();
	});

	it('evaluates when definitions arrive within the budget', async () => {
		const source = posthogFlagSource(() =>
			client({ isLocalEvaluationReady: () => false, waitForLocalEvaluationReady: async () => true })
		)!;
		expect(await source.isEnabled('labelkit-ar', 'o1')).toBe(true);
	});

	it('registers each org once with only its org_id, then evaluates', async () => {
		const identifyImmediate = vi.fn(async () => {});
		const source = posthogFlagSource(() => client({ identifyImmediate }))!;
		await Promise.all([source.isEnabled('a', 'o1'), source.isEnabled('b', 'o1')]);
		await source.isEnabled('a', 'o2');
		expect(identifyImmediate).toHaveBeenCalledTimes(2);
		expect(identifyImmediate).toHaveBeenCalledWith({
			distinctId: 'org_o1',
			properties: { org_id: 'o1' },
			disableGeoip: true
		});
	});

	it('still evaluates when registration fails or hangs', async () => {
		vi.useFakeTimers();
		try {
			const source = posthogFlagSource(() =>
				client({ identifyImmediate: () => new Promise(() => {}) })
			)!;
			const answer = source.isEnabled('a', 'o1');
			await vi.advanceTimersByTimeAsync(REGISTER_BUDGET_MS);
			expect(await answer).toBe(true);
			const failing = posthogFlagSource(() =>
				client({ identifyImmediate: async () => Promise.reject(new Error('down')) })
			)!;
			expect(await failing.isEnabled('a', 'o1')).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});

	it('retries registration after a rejection, but not while one is still in flight', async () => {
		let calls = 0;
		const identifyImmediate = vi.fn(async () => {
			calls++;
			if (calls === 1) throw new Error('PostHog down');
		});
		const source = posthogFlagSource(() => client({ identifyImmediate }))!;
		await source.isEnabled('a', 'o1');
		await source.isEnabled('a', 'o1');
		await source.isEnabled('a', 'o1');
		expect(identifyImmediate).toHaveBeenCalledTimes(2);
	});
});
