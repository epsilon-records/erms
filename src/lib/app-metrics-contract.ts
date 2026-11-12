/** Versioned wire contract. Only the first route is activated in this slice. */
export const METRICS_PATH = '/api/app-metrics';
/** Exact production origins only: never previews, deploy previews or other hosts. */
export const METRICS_ORIGINS = ['https://labelkit.co', 'https://erms.epsilonrecords.com'] as const;
export function isMetricsOrigin(origin: string | null | undefined): boolean {
	return typeof origin === 'string' && (METRICS_ORIGINS as readonly string[]).includes(origin);
}
export type Metric = 'document_mount_ms' | 'client_navigation_ms';
export type Sample = { v: 1; route: 'catalog_home'; metric: Metric; ms: number };
export function routeCode(id: string | null | undefined): 'catalog_home' | null {
	switch (id) {
		case '/':
			return 'catalog_home';
		default:
			return null;
	}
}
export function duration(ms: number): number | null {
	return Number.isFinite(ms) && ms >= 0 && ms <= 60000 ? Math.round(ms) : null;
}
export function bucket(ms: number): number {
	return [100, 250, 500, 1000, 2500, 5000, 10000, 60001].findIndex((n) => ms < n) + 1;
}
/** Flat grammar intentionally rejects nesting and duplicate (including escaped) member names. */
export function parseSample(text: string): Sample | null {
	try {
		const object = JSON.parse(text);
		if (!object || Array.isArray(object) || typeof object !== 'object') return null;
		const keys: string[] = [];
		// JSON forbids raw control characters in strings, so the grammar must name them.
		const grammar =
			// eslint-disable-next-line no-control-regex
			/^\s*\{\s*(?:"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"\s*:\s*(?:"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)\s*(?:,\s*|(?=\})))+\}\s*$/;
		if (!grammar.test(text) || /,\s*\}/.test(text)) return null;
		for (const match of text.matchAll(/("(?:[^"\\]|\\.)*")\s*:/g)) keys.push(JSON.parse(match[1]));
		if (
			keys.length !== 4 ||
			new Set(keys).size !== 4 ||
			keys.some((k) => !['v', 'route', 'metric', 'ms'].includes(k))
		)
			return null;
		if (
			object.v !== 1 ||
			object.route !== 'catalog_home' ||
			!['document_mount_ms', 'client_navigation_ms'].includes(object.metric) ||
			!Number.isInteger(object.ms) ||
			object.ms < 0 ||
			object.ms > 60000
		)
			return null;
		return { v: 1, route: 'catalog_home', metric: object.metric, ms: object.ms };
	} catch {
		return null;
	}
}
