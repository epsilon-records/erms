<script lang="ts">
	import '../app.css';
	import { onMount } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import favicon from '#lib/assets/favicon.svg';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();

	// The login callback lands on /?signed-in (see auth/callback); tidy the address bar.
	// onMount, not $effect: replaceState updates page.state, and an effect that read it
	// would rerun and replace the URL again in a loop.
	onMount(() => {
		const url = new URL(location.href);
		if (url.searchParams.has('signed-in')) {
			url.searchParams.delete('signed-in');
			replaceState(url.pathname + url.search + url.hash, {});
		}
	});

	const canImport = $derived(
		data.membership?.role === 'owner' || data.membership?.role === 'catalog_manager'
	);
	const canRights = $derived(
		data.membership?.role === 'owner' || data.membership?.role === 'rights_admin'
	);
	const canManageMembers = $derived(data.membership?.role === 'owner');
	const nav = $derived([
		{ href: '/releases', label: 'Releases' },
		{ href: '/artists', label: 'Artists' },
		{ href: '/compositions', label: 'Compositions' },
		...(canRights ? [{ href: '/rights', label: 'Rights' }] : []),
		...(canImport ? [{ href: '/import', label: 'Import' }] : []),
		...(canManageMembers ? [{ href: '/members', label: 'Members' }] : [])
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
			<form method="GET" action="/search" class="search" role="search">
				<label for="q" class="sr-only">Search the catalog</label>
				<input
					id="q"
					name="q"
					type="search"
					placeholder="Title, artist, ISRC, UPC, cat#"
					value={page.url.pathname === '/search' ? (page.url.searchParams.get('q') ?? '') : ''}
				/>
			</form>
		{/if}
		<div class="who">
			{#if data.memberships && data.memberships.length > 1}
				<form method="POST" action="/org" class="switch">
					<label for="org" class="sr-only">Label</label>
					<select id="org" name="orgId">
						{#each data.memberships as m (m.orgId)}
							<option value={m.orgId} selected={m.orgId === data.membership?.orgId}
								>{m.orgName}</option
							>
						{/each}
					</select>
					<button class="btn small">Switch</button>
				</form>
			{/if}
			<span class="muted">{data.user.email}</span>
			{#if data.membership?.onboardedAt}
				<a href="/onboarding" class="linkish">Get started</a>
			{/if}
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
	.switch {
		display: flex;
		gap: 8px;
		align-items: center;
	}
	.switch select {
		width: auto;
		padding: 6px 10px;
	}
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
