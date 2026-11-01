<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const a = $derived(data.artist);

	function fmt(ms: number | null) {
		if (ms == null) return '--:--';
		const s = Math.round(ms / 1000);
		return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	}
</script>

<pre><a href="/artists">&lt; artists</a></pre>
<pre>
+-- {a.party.displayName}
| RELEASES ... {a.releases.length}
| CREDITS .... {a.credits.length}
+--</pre>

{#if a.releases.length}
	<pre>RELEASES</pre>
	<table>
		<tbody>
			{#each a.releases as r (r.id)}
				<tr>
					<td>{r.releaseDate ?? '----------'}</td>
					<td><a href="/releases/{r.id}">{r.title}</a></td>
					<td class="dim">{r.type}</td>
					<td class="dim">{r.catalogNumber ?? ''}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

{#if a.credits.length}
	<pre>CREDITS</pre>
	<table>
		<tbody>
			{#each a.credits as c (c.recordingId + c.role)}
				<tr>
					<td class="dim">{c.role}</td>
					<td>
						{c.title}{#if c.versionTitle}<span class="dim"> ({c.versionTitle})</span>{/if}
					</td>
					<td class="mono">{c.isrc}</td>
					<td class="num">{fmt(c.durationMs)}</td>
				</tr>
			{/each}
		</tbody>
	</table>
{/if}

<style>
	table {
		border-collapse: collapse;
		margin-bottom: 1rem;
	}
	td {
		padding: 2px 2ch 2px 0;
	}
	.num {
		text-align: right;
	}
	.dim {
		color: #8a8a8a;
	}
</style>
