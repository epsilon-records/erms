<script lang="ts">
	import Landing from '#lib/components/Landing.svelte';
	import PublicAnalytics from '#lib/components/PublicAnalytics.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

{#if data.landing}
	<Landing signupOpen={data.signupOpen} />
	<PublicAnalytics />
{:else}
	<div class="container">
		{#if data.membership && data.stats}
			<section class="stack">
				<div class="eyebrow">
					<span class="tag">{data.membership.role.replace('_', ' ')}</span>
					<span>{data.membership.orgName}</span>
				</div>
				<h1 class="display">Catalog</h1>
			</section>

			<section class="stats" aria-label="Catalog at a glance">
				<a href="/releases"
					><span class="value">{data.stats.releases}</span><span class="label">Releases</span></a
				>
				<a href="/releases"
					><span class="value">{data.stats.recordings}</span><span class="label">Recordings</span
					></a
				>
				<a href="/artists"
					><span class="value">{data.stats.artists}</span><span class="label">Artists</span></a
				>
				<div>
					<span class="value" style:color={data.stats.pendingCredits ? 'var(--warn)' : undefined}
						>{data.stats.pendingCredits}</span
					><span class="label">Credits pending approval</span>
				</div>
				<div>
					<span class="value">{data.stats.missingDurations}</span><span class="label"
						>Recordings without a length</span
					>
				</div>
			</section>

			{#if data.lastImport}
				<p class="muted">
					Last import: {data.lastImport.fileName}, {data.lastImport.createdAt
						.toISOString()
						.slice(0, 16)
						.replace('T', ' ')} UTC
				</p>
			{:else if data.stats.releases === 0}
				<p><a href="/import" class="btn primary">Import a SymphonicMS export</a></p>
			{/if}
		{:else}
			<section class="stack">
				<h1 class="title">No organisation yet</h1>
				<p class="soft">Ask an owner to add {data.user?.email} to an organisation.</p>
			</section>
		{/if}
	</div>
{/if}
