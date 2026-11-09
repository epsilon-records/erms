import {
	duration,
	METRICS_ORIGIN,
	METRICS_PATH,
	routeCode,
	type Metric
} from './app-metrics-contract';

/** Scalar-only adapter seam: never pass URL, params, page data or the navigation object. */
export type Navigation = {
	from: string | null;
	to: string | null;
	type: string;
	leaving?: boolean;
};
export type Lifetime = {
	initial: boolean;
	sent: number;
	last: number;
	owner: symbol | null;
	abort: (() => void) | null;
};
export const createLifetime = (): Lifetime => ({
	initial: true,
	sent: 0,
	last: -Infinity,
	owner: null,
	abort: null
});
// Survives root remounts and module HMR, entirely in this document's memory.
export const documentLifetime: Lifetime = import.meta.hot?.data.metricsLifetime ?? createLifetime();
if (import.meta.hot) import.meta.hot.data.metricsLifetime = documentLifetime;
export function createCollector(options: {
	enabled: boolean;
	origin: string;
	fetch: typeof fetch;
	now: () => number;
	visible: () => boolean;
	lifetime?: Lifetime;
}) {
	const enabled = options.enabled && options.origin === METRICS_ORIGIN;
	const lifetime = options.lifetime ?? createLifetime();
	const owner = Symbol();
	if (enabled) {
		lifetime.abort?.();
		lifetime.owner = owner;
	}
	const owns = () => enabled && lifetime.owner === owner;
	let current: ReturnType<typeof routeCode> = null;
	let disposed = false;
	let pending: { start: number; to: 'catalog_home' } | null = null;
	let inFlight: AbortController | null = null;
	function invalidate() {
		pending = null;
		inFlight?.abort();
	}
	function emit(metric: Metric, elapsed: number) {
		const ms = duration(elapsed);
		if (
			!owns() ||
			disposed ||
			!options.visible() ||
			current !== 'catalog_home' ||
			ms === null ||
			inFlight ||
			lifetime.sent >= 20
		)
			return;
		const now = options.now();
		if (!Number.isFinite(now) || now - lifetime.last < 1000) return;
		lifetime.last = now;
		lifetime.sent++;
		const controller = new AbortController();
		inFlight = controller;
		lifetime.abort = () => controller.abort();
		const timer = setTimeout(() => controller.abort(), 1000);
		try {
			void options
				.fetch(METRICS_PATH, {
					method: 'POST',
					mode: 'same-origin',
					credentials: 'omit',
					referrerPolicy: 'no-referrer',
					redirect: 'error',
					cache: 'no-store',
					keepalive: false,
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ v: 1, route: 'catalog_home', metric, ms }),
					signal: controller.signal
				})
				.catch(() => {})
				.finally(() => {
					clearTimeout(timer);
					if (inFlight === controller) inFlight = null;
				});
		} catch {
			clearTimeout(timer);
			inFlight = null;
		}
	}
	return {
		before(n: Navigation) {
			const overlapping = pending !== null;
			invalidate();
			current = null;
			const from = routeCode(n.from),
				to = routeCode(n.to);
			// Same-symbol changes (including every home→home change in v1) are deliberately dropped.
			if (
				!owns() ||
				disposed ||
				overlapping ||
				!options.visible() ||
				n.leaving ||
				!['link', 'goto', 'popstate'].includes(n.type) ||
				!from ||
				!to ||
				from === to
			)
				return;
			pending = { start: options.now(), to };
		},
		after(id: string | null, type: string) {
			if (!owns() || disposed) return;
			current = routeCode(id);
			const p = pending;
			pending = null;
			if (lifetime.initial) {
				lifetime.initial = false;
				if (type === 'enter') emit('document_mount_ms', options.now());
				return;
			}
			if (p && current === p.to) emit('client_navigation_ms', options.now() - p.start);
		},
		invalidate,
		destroy() {
			disposed = true;
			invalidate();
			if (lifetime.owner === owner) {
				lifetime.owner = null;
				lifetime.abort = null;
			}
		}
	};
}
