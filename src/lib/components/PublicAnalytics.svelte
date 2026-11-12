<!--
	Cloudflare Web Analytics loader for public, signed-out pages (shared 0011, 0016). Mount it only
	from the pages in BEACON_PATHS, never from a layout: public-analytics.test.ts enforces both.
	With PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN unset, outside Netlify's production context or off
	https://labelkit.co it does nothing.
-->
<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import { PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN } from '$app/env/public';
	import {
		BEACON_SRC,
		beaconConfig,
		needsFullLoad,
		shouldLoadBeacon,
		siteToken
	} from '#lib/public-analytics.js';

	let installed = false;

	// Registered during init, as Kit requires; it acts only once this document has the beacon.
	beforeNavigate((navigation) => {
		if (!installed || navigation.willUnload || !needsFullLoad(location.href, navigation.to?.url))
			return;
		// A full page load: the beacon stays with the public document it was loaded on.
		navigation.cancel();
		location.assign(navigation.to!.url.href);
	});

	onMount(() => {
		try {
			const token = siteToken(PUBLIC_CLOUDFLARE_WEB_ANALYTICS_TOKEN);
			const ok = shouldLoadBeacon({
				token,
				environment: __SENTRY_ENVIRONMENT__,
				signedIn: Boolean(page.data.user),
				href: location.href,
				navigation: performance.getEntriesByType('navigation'),
				referrer: document.referrer,
				installed: Boolean(
					document.querySelector('script[data-cf-beacon], script[src*="cloudflareinsights.com/"]')
				)
			});
			if (!ok || !token) return;
			const beacon = document.createElement('script');
			beacon.src = BEACON_SRC;
			beacon.defer = true;
			beacon.referrerPolicy = 'no-referrer';
			beacon.setAttribute('data-cf-beacon', beaconConfig(token));
			document.head.append(beacon);
			installed = true;
		} catch {
			// An unexpected browser context never turns collection on.
		}
	});
</script>
