<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let q = $state('');

	const filtered = $derived(
		data.releases.filter((r) => {
			if (!q) return true;
			const hay =
				`${r.title} ${r.versionTitle ?? ''} ${r.catalogNumber ?? ''} ${r.upc} ${r.label} ${r.artists.map((a) => a.name).join(' ')}`.toLowerCase();
			return hay.includes(q.toLowerCase());
		})
	);
</script>

<pre>&gt; RELEASES ({filtered.length}/{data.releases.length})</pre>
<label>filter: <input bind:value={q} placeholder="title, artist, cat#, UPC" /></label>

{#if data.releases.length === 0}
	<pre class="dim">No releases yet. <a href="/import">[ import a SymphonicMS export ]</a></pre>
{:else}
	<table>
		<thead>
			<tr
				><th>date</th><th>cat#</th><th>title</th><th>artist</th><th>type</th><th>trk</th><th
					>label</th
				></tr
			>
		</thead>
		<tbody>
			{#each filtered as r (r.id)}
				<tr>
					<td>{r.releaseDate ?? '----------'}</td>
					<td>{r.catalogNumber ?? ''}</td>
					<td>
						<a href="/releases/{r.id}">{r.title}</a>{#if r.versionTitle}<span class="dim">
								({r.versionTitle})</span
							>{/if}
					</td>
					<td>
						{#each r.artists as a, i}{#if i},
							{/if}<a href="/artists/{a.id}">{a.name}</a>{/each}
					</td>
					<td>{r.type}</td>
					<td class="num">{r.trackCount}</td>
					<td class="dim">{r.label}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	table {
		border-collapse: collapse;
		width: 100%;
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
		padding: 2px 1.5ch 2px 0;
		vertical-align: top;
	}
	.num {
		text-align: right;
	}
	.dim {
		color: #8a8a8a;
	}
</style>
