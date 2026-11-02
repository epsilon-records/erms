<script lang="ts">
	import Ownership from '#lib/components/Ownership.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const comp = $derived(data.composition);
	const errors = $derived<Record<string, string>>(
		form && 'errors' in form && form.errors ? form.errors : {}
	);
	const values = $derived<Record<string, string>>(
		form && 'values' in form && form.values ? form.values : {}
	);
	const failed = (a: string) => !!form && 'action' in form && form.action === a && !form.ok;
	const ok = (a: string) => !!form && 'action' in form && form.action === a && form.ok;
	const errorText = (e: Record<string, string>) =>
		Object.entries(e)
			.map(([k, m]) => (['form', 'shares', 'writers'].includes(k) ? m : `${k}: ${m}`))
			.join('\n');

	const ROLES = [
		['composer_lyricist', 'Composer & lyricist'],
		['composer', 'Composer'],
		['lyricist', 'Lyricist'],
		['arranger', 'Arranger']
	];
	const WRITER_ROWS = 6;
	const writerValue = (i: number, field: 'writer' | 'role' | 'share') => {
		if (failed('writers')) return values[`${field}_${i}`] ?? '';
		const w = data.writers[i];
		if (!w) return field === 'role' ? 'composer_lyricist' : '';
		return field === 'writer' ? w.partyId : field === 'role' ? w.role : w.share;
	};
	const total = $derived(data.writers.reduce((a, w) => a + Number(w.share), 0));
	const linked = $derived(new Set(data.recordings.map((r) => r.id)));
</script>

<svelte:head><title>{comp.title} · ERMS</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow">
			<a href="/compositions" class="plain">Compositions</a>
			{#if comp.iswc}<span class="mono">{comp.iswc}</span>{/if}
		</div>
		<h1 class="display">{comp.title}</h1>
		{#if data.writers.length}
			<div class="byline">written by {data.writers.map((w) => w.name).join(', ')}</div>
		{/if}
	</section>

	<div class="split">
		<section class="side" aria-labelledby="recs-h">
			<h2 id="recs-h" class="h2">Recordings</h2>
			{#if data.recordings.length === 0}
				<p class="soft">No recordings linked.</p>
			{:else}
				<dl class="facts">
					{#each data.recordings as r (r.id)}
						<dt class="mono">{r.isrc}</dt>
						<dd>
							<a href="/recordings/{r.id}" class="plain" style="font-weight: 600">{r.title}</a
							>{#if r.versionTitle}<span class="muted"> · {r.versionTitle}</span>{/if}
							{#if data.can.write}
								<form method="POST" action="?/unlink" style="display: inline">
									<input type="hidden" name="recordingId" value={r.id} />
									<button class="linkish" aria-label="Unlink {r.title}">Unlink</button>
								</form>
							{/if}
						</dd>
					{/each}
				</dl>
			{/if}
			{#if data.recordingChoices}
				<form method="POST" action="?/link" class="stack" style="gap: 8px">
					<label for="link-rec">Link a recording</label>
					<select id="link-rec" name="recordingId" required>
						<option value="">—</option>
						{#each data.recordingChoices.filter((r) => !linked.has(r.id)) as r (r.id)}
							<option value={r.id}
								>{r.title}{r.versionTitle ? ` · ${r.versionTitle}` : ''} ({r.isrc})</option
							>
						{/each}
					</select>
					<div><button class="btn small">Link</button></div>
					{#if failed('link') || failed('unlink')}
						<div class="alert error" role="alert">{errorText(errors)}</div>
					{/if}
				</form>
			{/if}
		</section>

		<div class="main">
			{#if data.can.write}
				<form method="POST" action="?/save" class="stack" aria-labelledby="details-h">
					<h2 id="details-h" class="h2">Details</h2>
					<input type="hidden" name="updatedAt" value={comp.updatedAt.toISOString()} />
					<div class="form-grid">
						<label for="title">Title</label>
						<input
							id="title"
							name="title"
							value={failed('save') ? values.title : comp.title}
							required
						/>
						<label for="iswc">ISWC</label>
						<input
							id="iswc"
							name="iswc"
							class="mono"
							value={failed('save') ? values.iswc : (comp.iswc ?? '')}
							placeholder="T-123.456.789-0"
						/>
						<span></span>
						<div><button class="btn primary">Save</button></div>
					</div>
					{#if failed('save')}
						<div class="alert error" role="alert">{errorText(errors)}</div>
					{:else if ok('save')}
						<div class="alert ok" role="status">Saved.</div>
					{/if}
				</form>
			{/if}

			<section class="stack" aria-labelledby="writers-h">
				<h2 id="writers-h" class="h2">Writers</h2>
				{#if data.writers.length}
					<div class="table-wrap">
						<table class="data" style="min-width: 420px">
							<thead><tr><th>Writer</th><th>Role</th><th class="num">Split</th></tr></thead>
							<tbody>
								{#each data.writers as w (w.partyId + w.role)}
									<tr>
										<td><a href="/artists/{w.partyId}" class="plain">{w.name}</a></td>
										<td>{ROLES.find(([k]) => k === w.role)?.[1] ?? w.role}</td>
										<td class="num mono">{w.share}%</td>
									</tr>
								{/each}
								{#if total !== 100}
									<tr><td colspan="3" class="soft">Total {total}%</td></tr>
								{/if}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="soft">No writers recorded.</p>
				{/if}

				{#if data.options}
					<form method="POST" action="?/writers" class="stack" aria-label="Edit writers">
						<div class="stack" style="gap: 8px">
							{#each Array.from({ length: WRITER_ROWS }, (_, i) => i) as i (i)}
								<div class="inline-form">
									<label for="writer_{i}" class="sr-only">Writer {i + 1}</label>
									<select id="writer_{i}" name="writer_{i}" value={writerValue(i, 'writer')}>
										<option value="">—</option>
										{#each data.options.parties as p (p.id)}<option value={p.id}>{p.name}</option
											>{/each}
									</select>
									<label for="role_{i}" class="sr-only">Role {i + 1}</label>
									<select id="role_{i}" name="role_{i}" value={writerValue(i, 'role')}>
										{#each ROLES as [k, l] (k)}<option value={k}>{l}</option>{/each}
									</select>
									<label for="wshare_{i}" class="sr-only">Split {i + 1} (%)</label>
									<input
										id="wshare_{i}"
										name="share_{i}"
										class="mono"
										inputmode="decimal"
										placeholder="%"
										value={writerValue(i, 'share')}
										style="width: 110px"
									/>
								</div>
							{/each}
						</div>
						<p class="soft">Splits replace the current ones and must total 100%.</p>
						<div><button class="btn primary">Save writers</button></div>
						{#if failed('writers')}
							<div class="alert error" role="alert">{errorText(errors)}</div>
						{:else if ok('writers')}
							<div class="alert ok" role="status">Writers saved.</div>
						{/if}
					</form>
				{/if}
			</section>

			{#if data.publishing}
				<section class="stack" aria-labelledby="pub-h">
					<h2 id="pub-h" class="h2">Publishing</h2>
					<Ownership
						groups={data.publishing}
						options={data.options}
						action="setPublishing"
						emptyText="No publishing ownership recorded."
						errors={failed('setPublishing') ? errors : {}}
						values={failed('setPublishing') ? values : {}}
						saved={ok('setPublishing')}
					/>
				</section>
			{/if}
		</div>
	</div>
</div>
