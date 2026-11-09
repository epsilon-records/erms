/** Used only by Sentry filtering, never as collector input. No request is serialized here. */
export function isMetricsRequest(url: unknown): boolean {
	if (typeof url !== 'string') return false;
	return /^(?:https?:\/\/[^/]+)?\/api\/(?:app-metrics|internal\/app-metrics-prune)(?:[?#]|$)/.test(
		url
	);
}
