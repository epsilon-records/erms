import { error } from '@sveltejs/kit';

/**
 * Per-org feature switches (EPSILON-133, shared 0052).
 *
 * Flags live in PostHog and are evaluated on the server from cached definitions, so a PostHog
 * outage or missing keys never reaches PostHog per request: a feature then takes its default.
 * The org is the flag subject: distinct ID `org_<id>`, with an `org_id` property to target on.
 */
export const FEATURES = {
	/** A&R pipeline: demo intake and signing decisions (EPSILON-140). */
	ar: { flag: 'labelkit-ar', default: false },
	/** Recoupment tracking (M6). */
	recoupment: { flag: 'labelkit-recoupment', default: false }
} as const satisfies Record<string, { flag: string; default: boolean }>;

export type Feature = keyof typeof FEATURES;
export type Features = Record<Feature, boolean>;

/** Something that can evaluate one flag for one org; undefined means "no answer". */
export interface FlagSource {
	isEnabled(flag: string, orgId: string): Promise<boolean | undefined>;
}

/** Evaluates every feature for an org. Errors and missing answers fall back to the default. */
export async function featuresFor(source: FlagSource | null, orgId: string): Promise<Features> {
	const entries = await Promise.all(
		(Object.keys(FEATURES) as Feature[]).map(async (name) => {
			const { flag, default: fallback } = FEATURES[name];
			if (!source) return [name, fallback] as const;
			try {
				return [name, (await source.isEnabled(flag, orgId)) ?? fallback] as const;
			} catch {
				return [name, fallback] as const;
			}
		})
	);
	return Object.fromEntries(entries) as Features;
}

/** Throws 404 unless the request's org has the feature, so gated routes look like they don't exist. */
export async function requireFeature(
	source: FlagSource | null,
	orgId: string | undefined,
	feature: Feature
): Promise<void> {
	if (!orgId) error(404, 'Not found.');
	const features = await featuresFor(source, orgId);
	if (!features[feature]) error(404, 'Not found.');
}
