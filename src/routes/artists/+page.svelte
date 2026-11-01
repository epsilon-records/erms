<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let q = $state('');
	const filtered = $derived(
		data.artists.filter((a) => !q || a.name.toLowerCase().includes(q.toLowerCase()))
	);
</script>

<pre>&gt; ARTISTS ({filtered.length}/{data.artists.length})</pre>
<label>filter: <input bind:value={q} placeholder="name" /></label>

<table>
	<thead>
		<tr
			><th>name</th><th class="num">releases</th><th class="num">recordings</th><th class="num"
				>remixes</th
			></tr
		>
	</thead>
	<tbody>
		{#each filtered as a (a.id)}
			<tr>
				<td><a href="/artists/{a.id}">{a.name}</a></td>
				<td class="num">{a.releases}</td>
				<td class="num">{a.recordings}</td>
				<td class="num">{a.remixes}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	table {
		border-collapse: collapse;
		margin-top: 1rem;
	}
	th {
		text-align: left;
		color: #8a8a8a;
		font-weight: normal;
		border-bottom: 1px dashed #555;
	}
	td,
	th {
		padding: 2px 3ch 2px 0;
	}
	.num {
		text-align: right;
	}
</style>
