<script>
	import { browser } from '$app/env';
	import { goto } from '$app/navigation';
	import AppMetrics from '@metrics/AppMetrics.svelte';
	import { createCollector, documentLifetime } from '@metrics/app-metrics-client';
	import { METRICS_ORIGIN } from '@metrics/app-metrics-contract';
	let { children } = $props();
	// Isolated fixture constructor seam, never included in the production build.
	const collector = browser
		? createCollector({
				enabled: globalThis.fixtureEnabled !== false,
				lifetime: documentLifetime,
				origin: METRICS_ORIGIN,
				fetch: window.fetch.bind(window),
				now: () => performance.now(),
				visible: () => document.visibilityState === 'visible'
			})
		: null;
	if (browser) {
		globalThis.fixtureGoto = goto;
		globalThis.fixtureCollector = collector;
	}
</script>

{#if collector}<AppMetrics {collector} />{/if}
<a id="home" href="/">Home</a><a
	id="entity"
	href="/releases/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa?token=FAKE_METRIC_SECRET">Entity</a
>
{@render children()}
