<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	// The header search lands here with ?q=; the filter then narrows as you type.
	let q = $state('');
	$effect.pre(() => {
		q = data.q;
	});

	const filtered = $derived(
		data.releases.filter((r) => {
			if (!q) return true;
			const hay =
				`${r.title} ${r.versionTitle ?? ''} ${r.catalogNumber ?? ''} ${r.upc} ${r.label} ${r.artists.map((a) => a.name).join(' ')}`.toLowerCase();
			return hay.includes(q.toLowerCase());
		})
	);
</script>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow"><span>{filtered.length} of {data.releases.length}</span></div>
			<h1 class="title">Releases</h1>
		</div>
		<div style="width: 320px; max-width: 100%">
			<label for="filter" class="sr-only">Filter releases</label>
			<input id="filter" bind:value={q} placeholder="Filter by title, artist, cat#, UPC" />
		</div>
	</section>

	{#if data.releases.length === 0}
		<p class="soft">No releases yet. <a href="/import">Import a SymphonicMS export</a>.</p>
	{:else}
		<div class="table-wrap">
			<table class="data" style="min-width: 820px">
				<thead>
					<tr>
						<th>Date</th>
						<th>Title</th>
						<th>Artist</th>
						<th>Type</th>
						<th class="num">Tracks</th>
						<th>Cat#</th>
						<th>Label</th>
					</tr>
				</thead>
				<tbody>
					{#each filtered as r (r.id)}
						<tr>
							<td class="mono muted">{r.releaseDate ?? '—'}</td>
							<td>
								<a
									href="/releases/{r.id}"
									class="plain"
									style="font-weight: 600; color: var(--text-strong)">{r.title}</a
								>{#if r.versionTitle}<span class="muted"> · {r.versionTitle}</span>{/if}
							</td>
							<td>
								{#each r.artists as a, i (a.id)}{#if i},
									{/if}<a href="/artists/{a.id}" class="plain soft">{a.name}</a>{/each}
							</td>
							<td><span class="tag outline">{r.type}</span></td>
							<td class="num mono">{r.trackCount}</td>
							<td class="mono muted">{r.catalogNumber ?? ''}</td>
							<td class="muted">{r.label}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}
</div>
