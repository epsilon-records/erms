<script lang="ts">
	import Credits from '#lib/components/Credits.svelte';
	import Masters from '#lib/components/Masters.svelte';
	import Ownership from '#lib/components/Ownership.svelte';
	import RecordingAnalysis from '#lib/components/RecordingAnalysis.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const rec = $derived(data.recording);
	const errors = $derived<Record<string, string>>(
		form && 'errors' in form && form.errors ? form.errors : {}
	);
	const values = $derived<Record<string, string>>(
		form && 'values' in form && form.values ? form.values : {}
	);
	const failed = (a: string) => form && 'action' in form && form.action === a && !form.ok;
	const saved = $derived(form && 'action' in form && form.action === 'save' && form.ok);
	const runFailed = $derived(failed('runAnalysis'));
	const runError = $derived(
		runFailed ? (Object.values(errors)[0] ?? 'Could not queue the analysis job.') : null
	);
	const runQueued = $derived(
		!!(form && 'action' in form && form.action === 'runAnalysis' && form.ok)
	);

	function fmt(ms: number | null) {
		if (ms == null) return '';
		const s = Math.round(ms / 1000);
		return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
	}
	const v = (field: string, fallback: string | null) =>
		failed('save') ? (values[field] ?? '') : (fallback ?? '');

	const ROLES = [
		'main',
		'featured',
		'remixer',
		'producer',
		'writer',
		'composer',
		'mixer',
		'mastering'
	];
	const mains = $derived(data.credits.filter((c) => c.role === 'main'));
</script>

<div class="container">
	<section class="stack">
		<div class="eyebrow">
			<span class="tag">Recording</span>
			<span>{rec.isrc}</span>
			{#if rec.durationMs}<span>{fmt(rec.durationMs)}</span>{/if}
			{#if rec.subgenre || rec.genre}<span>{rec.subgenre ?? rec.genre}</span>{/if}
		</div>
		<h1 class="display">
			{rec.title}
			{#if rec.versionTitle}
				<span class="muted" style="display: block; font-size: 0.4em; font-weight: 500">
					{rec.versionTitle}
				</span>
			{/if}
		</h1>
		{#if mains.length}
			<div class="byline">
				by {#each mains as c, i (c.id)}{#if i},
					{/if}<a href="/artists/{c.partyId}">{c.name}</a>{/each}
			</div>
		{/if}
	</section>

	<div class="split">
		<section class="side" aria-labelledby="on-releases">
			<h2 id="on-releases" class="h2">On releases</h2>
			<dl class="facts">
				{#each data.releases as r (r.id)}
					<dt class="mono">{r.releaseDate ?? '—'} · #{r.position}</dt>
					<dd><a href="/releases/{r.id}" class="plain" style="font-weight: 600">{r.title}</a></dd>
				{/each}
			</dl>
		</section>

		<div class="main">
			{#if data.can.edit}
				<form method="POST" action="?/save" class="stack" aria-labelledby="details-h">
					<h2 id="details-h" class="h2">Details</h2>
					<input type="hidden" name="updatedAt" value={rec.updatedAt.toISOString()} />
					<div class="form-grid">
						<label for="title">Title</label>
						<input id="title" name="title" value={v('title', rec.title)} required />
						<label for="versionTitle">Version</label>
						<input
							id="versionTitle"
							name="versionTitle"
							value={v('versionTitle', rec.versionTitle)}
							placeholder="e.g. Extended Mix"
						/>
						<label for="isrc">ISRC</label>
						<input id="isrc" name="isrc" class="mono" value={v('isrc', rec.isrc)} required />
						<label for="duration">Length</label>
						<input
							id="duration"
							name="duration"
							class="mono"
							value={v('duration', fmt(rec.durationMs))}
							placeholder="mm:ss"
						/>
						<label for="genre">Genre</label>
						<input id="genre" name="genre" value={v('genre', rec.genre)} />
						<label for="subgenre">Subgenre</label>
						<input id="subgenre" name="subgenre" value={v('subgenre', rec.subgenre)} />
						<span></span>
						<div><button class="btn primary">Save</button></div>
					</div>
					{#if failed('save')}
						<div class="alert error" role="alert">
							{Object.entries(errors)
								.map(([k, m]) => (k === 'form' ? m : `${k}: ${m}`))
								.join('\n')}
						</div>
					{:else if saved}
						<div class="alert ok" role="status">Saved.</div>
					{/if}
				</form>
			{/if}

			<section class="stack" aria-labelledby="works-h">
				<h2 id="works-h" class="h2">Composition</h2>
				{#if data.compositions.length}
					<ul class="stack" style="gap: 6px; list-style: none; padding: 0; margin: 0">
						{#each data.compositions as c (c.id)}
							<li>
								<a href="/compositions/{c.id}" class="plain" style="font-weight: 600">{c.title}</a>
								{#if c.iswc}<span class="mono muted"> · {c.iswc}</span>{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="soft">Not linked to a composition yet.</p>
				{/if}
				{#if data.compositionChoices}
					<div class="row" style="flex-wrap: wrap; gap: 24px; align-items: flex-end">
						<form method="POST" action="?/newComposition" class="inline-form">
							<label for="comp-title" class="sr-only">New composition title</label>
							<input
								id="comp-title"
								name="title"
								value={failed('newComposition') ? values.title : rec.title}
								required
							/>
							<label for="comp-iswc" class="sr-only">ISWC</label>
							<input
								id="comp-iswc"
								name="iswc"
								class="mono"
								placeholder="ISWC (optional)"
								value={failed('newComposition') ? values.iswc : ''}
								style="width: 170px"
							/>
							<button class="btn small">New composition</button>
						</form>
						{#if data.compositionChoices.length}
							<form method="POST" action="?/linkComposition" class="inline-form">
								<label for="comp-link" class="sr-only">Existing composition</label>
								<select id="comp-link" name="compositionId" required>
									<option value="">Link existing…</option>
									{#each data.compositionChoices.filter((c) => !data.compositions.some((x) => x.id === c.id)) as c (c.id)}
										<option value={c.id}>{c.title}{c.iswc ? ` (${c.iswc})` : ''}</option>
									{/each}
								</select>
								<button class="btn small">Link</button>
							</form>
						{/if}
					</div>
					{#if failed('newComposition') || failed('linkComposition')}
						<div class="alert error" role="alert">
							{Object.entries(errors)
								.map(([k, m]) => (k === 'form' ? m : `${k}: ${m}`))
								.join('\n')}
						</div>
					{/if}
				{/if}
			</section>

			<section class="stack" aria-labelledby="master-file-h">
				<h2 id="master-file-h" class="h2">Master file</h2>
				<Masters
					recordingId={rec.id}
					masters={data.masters}
					canUpload={data.can.uploadMaster}
					enabled={data.uploadsEnabled}
				/>
			</section>

			<section class="stack" aria-labelledby="analysis-h">
				<h2 id="analysis-h" class="h2">Analysis</h2>
				<RecordingAnalysis
					recordingId={rec.id}
					analysis={data.analysis}
					canRun={data.can.runAnalysis}
					previewPlayable={data.previewPlayable}
					{runError}
					queued={runQueued}
				/>
			</section>

			{#if data.ownership}
				<section class="stack" aria-labelledby="master-h">
					<h2 id="master-h" class="h2">Master ownership</h2>
					<Ownership
						groups={data.ownership}
						options={data.holders}
						action="setMaster"
						errors={failed('setMaster') ? errors : {}}
						values={failed('setMaster') ? values : {}}
						saved={!!(form && 'action' in form && form.action === 'setMaster' && form.ok)}
					/>
				</section>
			{/if}

			<section class="stack" aria-labelledby="credits-h">
				<h2 id="credits-h" class="h2">Credits</h2>
				<Credits
					credits={data.credits}
					canEdit={data.can.edit}
					canApprove={data.can.approve}
					roles={ROLES}
					errors={failed('addCredit') || failed('removeCredit') || failed('approveCredit')
						? errors
						: {}}
					values={failed('addCredit') ? values : {}}
				/>
			</section>
		</div>
	</div>
</div>
