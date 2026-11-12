import { describe, expect, it, vi } from 'vitest';
import { posthogFlagSource, READY_BUDGET_MS, type FlagClient } from './posthog-flags.js';

function client(over: Partial<FlagClient> = {}): FlagClient {
	return {
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
});
