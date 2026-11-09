<script module lang="ts">
	const mounted = new WeakSet<object>();
</script>

<script lang="ts">
	import { onDestroy } from 'svelte';
	import { beforeNavigate, afterNavigate } from '$app/navigation';
	import { page } from '$app/state';
	import type { createCollector } from './app-metrics-client';
	let { collector }: { collector: ReturnType<typeof createCollector> } = $props();
	if (!mounted.has(collector)) {
		mounted.add(collector);
		beforeNavigate((n) =>
			collector.before({
				from: n.from?.route.id ?? null,
				to: n.to?.route.id ?? null,
				type: n.type,
				leaving: n.willUnload
			})
		);
		// Kit 3.1's initial navigation target can carry null even when page.route is known.
		// Both sources are framework route identities, never a URL-derived fallback.
		afterNavigate((n) =>
			collector.after(n.type === 'enter' ? page.route.id : (n.to?.route.id ?? null), n.type)
		);
		const invalidate = () => collector.invalidate();
		document.addEventListener('visibilitychange', invalidate);
		window.addEventListener('pagehide', invalidate);
		window.addEventListener('pageshow', invalidate);
		onDestroy(() => {
			mounted.delete(collector);
			collector.destroy();
			document.removeEventListener('visibilitychange', invalidate);
			window.removeEventListener('pagehide', invalidate);
			window.removeEventListener('pageshow', invalidate);
		});
	}
</script>
