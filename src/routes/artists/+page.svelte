<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let q = $state('');
	const filtered = $derived(
		data.artists.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()))
	);
</script>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow"><span>{filtered.length} of {data.artists.length}</span></div>
			<h1 class="title">Artists</h1>
		</div>
		<div style="width: 320px; max-width: 100%">
			<label for="filter" class="sr-only">Filter artists</label>
			<input id="filter" bind:value={q} placeholder="Filter by name" />
		</div>
	</section>

	<div class="table-wrap">
		<table class="data" style="min-width: 520px">
			<thead>
				<tr>
					<th>Name</th>
					<th class="num">Releases</th>
					<th class="num">Recordings</th>
					<th class="num">Remixes</th>
				</tr>
			</thead>
			<tbody>
				{#each filtered as a (a.id)}
					<tr>
						<td
							><a
								href="/artists/{a.id}"
								class="plain"
								style="font-weight: 600; color: var(--text-strong)">{a.name}</a
							></td
						>
						<td class="num mono">{a.releases}</td>
						<td class="num mono">{a.recordings}</td>
						<td class="num mono">{a.remixes}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
