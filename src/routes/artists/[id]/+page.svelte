<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const a = $derived(data.artist);
	const renameError = $derived(
		form && 'errors' in form && form.errors ? Object.values(form.errors)[0] : null
	);
	const renamed = $derived(form && 'ok' in form && form.ok);

	function fmt(ms: number | null) {
		if (ms == null) return '—';
		const s = Math.round(ms / 1000);
		return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
	}
</script>

<div class="container">
	<section class="stack">
		<div class="eyebrow">
			<a href="/artists" class="plain muted">← Artists</a>
			<span class="tag">Artist</span>
			<span>{a.releases.length} releases</span>
			<span>{a.credits.length} credits</span>
		</div>
		<h1 class="display">{a.party.displayName}</h1>
		{#if data.can.edit}
			<form method="POST" action="?/rename" class="inline-form" style="max-width: 560px">
				<label for="displayName" class="sr-only">Artist name</label>
				<input id="displayName" name="displayName" value={a.party.displayName} required />
				<button class="btn">Rename</button>
			</form>
			{#if renameError}<div class="alert error" role="alert">{renameError}</div>{/if}
			{#if renamed}<div class="alert ok" role="status">Saved.</div>{/if}
		{/if}
	</section>

	<div class="split">
		<section class="side" aria-labelledby="rel-h">
			<h2 id="rel-h" class="h2">Releases</h2>
			{#if a.releases.length}
				<dl class="facts">
					{#each a.releases as r (r.id)}
						<dt class="mono">{r.releaseDate ?? '—'} · {r.type}</dt>
						<dd><a href="/releases/{r.id}" class="plain" style="font-weight: 600">{r.title}</a></dd>
					{/each}
				</dl>
			{:else}
				<p class="muted" style="margin: 0">Not a release artist.</p>
			{/if}
		</section>

		<section class="main" aria-labelledby="cred-h">
			<h2 id="cred-h" class="h2">Credits</h2>
			<div class="table-wrap">
				<table class="data" style="min-width: 560px">
					<thead>
						<tr><th>Role</th><th>Recording</th><th>ISRC</th><th class="num">Time</th></tr>
					</thead>
					<tbody>
						{#each a.credits as c (c.recordingId + c.role)}
							<tr>
								<td class="mono muted">{c.role}</td>
								<td>
									<a href="/recordings/{c.recordingId}" class="plain" style="font-weight: 600"
										>{c.title}</a
									>{#if c.versionTitle}<span class="muted"> · {c.versionTitle}</span>{/if}
								</td>
								<td class="mono soft">{c.isrc}</td>
								<td class="mono num">{fmt(c.durationMs)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	</div>
</div>
