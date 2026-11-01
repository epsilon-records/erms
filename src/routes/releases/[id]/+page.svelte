<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const r = $derived(data.release);

	function fmt(ms: number | null) {
		if (ms == null) return '—';
		const s = Math.round(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}
	const total = $derived(r.tracks.reduce((sum, t) => sum + (t.recording.durationMs ?? 0), 0));
	const longest = $derived(Math.max(1, ...r.tracks.map((t) => t.recording.durationMs ?? 0)));
	const pending = $derived(
		r.tracks.reduce((n, t) => n + t.credits.filter((c) => !c.approvedAt).length, 0) +
			r.artists.filter((a) => !a.approvedAt).length
	);
	const date = $derived(r.releaseDate ? r.releaseDate.split('-').reverse().join('.') : null);
</script>

<div class="container">
	<section class="stack">
		<div class="eyebrow">
			<a href="/releases" class="plain muted">← Releases</a>
			<span class="tag">{r.type}</span>
			{#if r.catalogNumber}<span>{r.catalogNumber}</span>{/if}
			{#if date}<span>{date}</span>{/if}
			<span>{r.label}</span>
			{#if r.subgenre || r.genre}<span>{r.subgenre ?? r.genre}</span>{/if}
		</div>
		<div class="spread">
			<h1 class="display">
				{r.title}{#if r.versionTitle}<span class="muted" style="font-size: 0.4em; font-weight: 500">
						{r.versionTitle}</span
					>{/if}
			</h1>
			{#if data.can.edit}
				<div class="btn-group">
					<a href="/releases/{r.id}/edit" class="btn primary">Edit</a>
				</div>
			{/if}
		</div>
		<div class="byline">
			by {#each r.artists as a, i (a.id)}{#if i},
				{/if}<a href="/artists/{a.id}">{a.name}</a>{/each}
		</div>
	</section>

	<div class="split">
		<aside class="side" aria-label="Release details">
			<div class="art" role="img" aria-label="No artwork yet">No artwork yet</div>
			<dl class="facts">
				<dt>UPC</dt>
				<dd class="mono">{r.upc}</dd>
				<dt>Label</dt>
				<dd>{r.label}</dd>
				<dt>Genre</dt>
				<dd>{[r.genre, r.subgenre].filter(Boolean).join(' / ') || '—'}</dd>
				<dt>Tracks</dt>
				<dd class="mono">{r.tracks.length} · {fmt(total)}</dd>
				<dt>Credits</dt>
				<dd>
					{#if pending}<span class="pending">{pending} pending</span>{:else}All approved{/if}
				</dd>
			</dl>
		</aside>

		<section class="main" aria-label="Tracklist">
			<div class="table-wrap">
				<table class="data roomy" style="min-width: 680px">
					<thead>
						<tr>
							<th style="width: 48px">No.</th>
							<th>Title</th>
							<th style="width: 140px">Length</th>
							<th>ISRC</th>
							<th class="num">Time</th>
						</tr>
					</thead>
					<tbody>
						{#each r.tracks as t (t.position)}
							<tr>
								<td class="mono muted">{String(t.position).padStart(2, '0')}</td>
								<td>
									<a href="/recordings/{t.recording.id}" class="track-title">{t.recording.title}</a>
									<div class="muted" style="margin-top: 4px; font-size: 14px">
										{#if t.recording.versionTitle}{`${t.recording.versionTitle} — `}{/if}{#each t.credits as c, i (c.id)}{#if i},
											{/if}{#if c.role !== 'main'}<span>{c.role}</span>
											{/if}<a href="/artists/{c.partyId}" class="plain soft">{c.name}</a
											>{#if !c.approvedAt}
												<span class="pending">pending</span>{/if}{/each}
									</div>
								</td>
								<td>
									<span class="bar" aria-hidden="true"
										><span style:width="{((t.recording.durationMs ?? 0) / longest) * 100}%"
										></span></span
									>
								</td>
								<td class="mono soft">{t.recording.isrc}</td>
								<td class="mono num">{fmt(t.recording.durationMs)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	</div>
</div>
