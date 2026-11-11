<script lang="ts">
	import type { Snippet } from 'svelte';

	// Shared frame for /privacy and /terms: public pages, readable signed in or out.
	let { title, effective, children }: { title: string; effective: string; children: Snippet } =
		$props();
</script>

<svelte:head><title>{title} · LabelKit</title></svelte:head>

<div class="container legal">
	<p><a href="/" class="linkish">LabelKit</a></p>
	<h1 class="title">{title}</h1>
	<p class="soft">Effective {effective}</p>
	{@render children()}
	<p class="soft">
		<a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> · © 2015–2026 Epsilon Records
	</p>
</div>

<style>
	.legal {
		max-width: 46em;
	}
	.legal :global(h2) {
		margin-top: 2em;
		font-size: 20px;
	}
	.legal :global(li) {
		margin-bottom: 0.4em;
	}
</style>
