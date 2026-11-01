<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.release);

	function fmt(ms: number | null) {
		if (ms == null) return '--:--';
		const s = Math.round(ms / 1000);
		return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	}
	const total = $derived(r.tracks.reduce((sum, t) => sum + (t.recording.durationMs ?? 0), 0));
</script>

<pre><a href="/releases">&lt; releases</a></pre>
<pre>
+-- {r.title}{r.versionTitle ? ` (${r.versionTitle})` : ''}
|
| ARTIST ..... {r.artists.map((a) => a.name).join(', ')}
| LABEL ...... {r.label}
| TYPE ....... {r.type}
| DATE ....... {r.releaseDate ?? 'unknown'}
| CAT# ....... {r.catalogNumber ?? ''}
| UPC ........ {r.upc}
| GENRE ...... {[r.genre, r.subgenre].filter(Boolean).join(' / ')}
| TRACKS ..... {r.tracks.length} · {fmt(total)}
+--</pre>

<table>
	<thead>
		<tr><th>#</th><th>title</th><th>credits</th><th>isrc</th><th>time</th></tr>
	</thead>
	<tbody>
		{#each r.tracks as t (t.position)}
			<tr>
				<td class="num">{t.position}</td>
				<td>
					{t.recording.title}{#if t.recording.versionTitle}<span class="dim">
							({t.recording.versionTitle})</span
						>{/if}
				</td>
				<td>
					{#each t.credits as c, i}{#if i}<br />{/if}<span class="dim">{c.role}</span>
						<a href="/artists/{c.partyId}">{c.name}</a>{/each}
				</td>
				<td class="mono">{t.recording.isrc}</td>
				<td class="num">{fmt(t.recording.durationMs)}</td>
			</tr>
		{/each}
	</tbody>
</table>

<style>
	table {
		border-collapse: collapse;
		width: 100%;
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
