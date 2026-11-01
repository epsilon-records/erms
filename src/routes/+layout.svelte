<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	const canImport = $derived(
		data.membership?.role === 'owner' || data.membership?.role === 'catalog_manager'
	);
	const nav = $derived([
		{ href: '/releases', label: 'Releases' },
		{ href: '/artists', label: 'Artists' },
		...(canImport ? [{ href: '/import', label: 'Import' }] : [])
	]);
	const isCurrent = (href: string) => page.url.pathname.startsWith(href);
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<title>ERMS</title>
</svelte:head>

{#if data.user}
	<header class="topbar">
		<a href="/" class="brand plain">ERMS<span class="slash">/</span></a>
		{#if data.membership}
			<nav aria-label="Main">
				{#each nav as item (item.href)}
					<a href={item.href} class="plain" aria-current={isCurrent(item.href) ? 'page' : undefined}
						>{item.label}</a
					>
				{/each}
			</nav>
		{/if}
		<div class="grow"></div>
		{#if data.membership}
			<form method="GET" action="/releases" class="search">
				<label for="q" class="sr-only">Search releases</label>
				<input id="q" name="q" type="search" placeholder="Title, artist, cat#, UPC" />
			</form>
		{/if}
		<div class="who">
			<span class="muted">{data.user.email}</span>
			<form method="POST" action="/logout"><button class="linkish">Log out</button></form>
		</div>
	</header>
{/if}

<main id="content">{@render children()}</main>

<style>
	.topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: stretch;
		gap: 0 32px;
		padding: 0 48px;
		border-bottom: 1px solid var(--line);
	}
	@media (max-width: 640px) {
		.topbar {
			padding: 0 20px;
			gap: 0 20px;
		}
	}
	.brand,
	nav a,
	.who,
	.search {
		display: flex;
		align-items: center;
		min-height: 64px;
	}
	.brand {
		font-family: var(--mono);
		font-weight: 500;
		color: var(--text-strong);
	}
	.slash {
		color: var(--accent);
	}
	nav {
		display: flex;
		flex-wrap: wrap;
		gap: 0 28px;
	}
	nav a {
		color: var(--muted);
	}
	nav a:hover {
		color: var(--text-strong);
	}
	nav a[aria-current='page'] {
		color: var(--text-strong);
		font-weight: 600;
		box-shadow: inset 0 -3px 0 var(--accent);
	}
	.grow {
		flex-grow: 1;
	}
	.search input {
		width: 240px;
		max-width: 60vw;
		min-height: 40px;
	}
	.who {
		gap: 16px;
		font-size: 13px;
	}
</style>
