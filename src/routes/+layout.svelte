<script lang="ts">
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>ERMS</title>
</svelte:head>

<div class="term">
	<header>
		<pre class="banner">+--------------------------------------------------+
|  E R M S   ::   Epsilon Records Management System |
+--------------------------------------------------+</pre>
		{#if data.user}
			<nav>
				<span>[ {data.user.email} ]</span>
				<form method="POST" action="/logout"><button>[ logout ]</button></form>
			</nav>
		{/if}
	</header>
	<main>{@render children()}</main>
</div>

<style>
	:global(html, body) {
		margin: 0;
		background: #0b0b0b;
		color: #d8d8d8;
		font-family: 'IBM Plex Mono', 'Courier New', monospace;
		font-size: 15px;
	}
	:global(a),
	:global(button) {
		color: #7cff7c;
		background: none;
		border: none;
		font: inherit;
		cursor: pointer;
		padding: 0;
		text-decoration: none;
	}
	:global(a:hover),
	:global(button:hover) {
		text-decoration: underline;
	}
	:global(input) {
		background: #0b0b0b;
		color: #d8d8d8;
		border: 1px solid #555;
		font: inherit;
		padding: 4px 8px;
	}
	.term {
		max-width: 80ch;
		margin: 2rem auto;
		padding: 0 1rem;
	}
	.banner {
		color: #7cff7c;
		margin: 0 0 1rem;
	}
	nav {
		display: flex;
		gap: 2ch;
		margin-bottom: 1.5rem;
	}
	nav form {
		display: inline;
	}
</style>
