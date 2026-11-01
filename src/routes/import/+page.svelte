<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const kinds = ['labels', 'parties', 'recordings', 'releases', 'tracks', 'credits'] as const;
	const kindLabel: Record<(typeof kinds)[number], string> = {
		labels: 'Labels',
		parties: 'Artists',
		recordings: 'Recordings',
		releases: 'Releases',
		tracks: 'Tracks',
		credits: 'Credits'
	};
	const stage = $derived(form && 'stage' in form ? form.stage : null);
	const when = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');
</script>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>SymphonicMS inventory export</span></div>
		<h1 class="title">Import</h1>
	</section>

	{#if !stage || stage === 'blocked'}
		<form method="POST" action="?/preview" enctype="multipart/form-data" class="stack">
			<div class="inline-form" style="max-width: 640px">
				<label for="file" class="sr-only">CSV file</label>
				<input id="file" type="file" name="file" accept=".csv,text/csv" required />
				<button class="btn primary">Dry run</button>
			</div>
			<p class="muted" style="margin: 0">
				A dry run changes nothing. It shows what the import would create or update.
			</p>
		</form>
	{/if}

	{#if form && 'error' in form && form.error}
		<div class="alert error" role="alert">{form.error}</div>
	{/if}

	{#if form && 'summary' in form && form.summary}
		{@const s = form.summary}
		<section class="stack" aria-labelledby="summary-h">
			<div class="spread">
				<h2 id="summary-h" class="h2">{form.fileName}</h2>
				<span class="mono muted" title={form.sha256}>sha256 {form.sha256?.slice(0, 16)}…</span>
			</div>
			<div class="stats">
				<div><span class="value">{s.rows}</span><span class="label">Rows</span></div>
				<div><span class="value">{s.releases}</span><span class="label">Releases</span></div>
				<div><span class="value">{s.recordings}</span><span class="label">Recordings</span></div>
				<div><span class="value">{s.parties}</span><span class="label">Artists</span></div>
				<div><span class="value">{s.labels}</span><span class="label">Labels</span></div>
				<div>
					<span class="value" style:color={s.errors ? 'var(--danger)' : undefined}>{s.errors}</span>
					<span class="label">Errors</span>
				</div>
				<div>
					<span class="value" style:color={s.warnings ? 'var(--warn)' : undefined}
						>{s.warnings}</span
					>
					<span class="label">Warnings</span>
				</div>
			</div>
		</section>

		{#if 'counts' in form && form.counts}
			{@const c = form.counts}
			<section class="stack" aria-labelledby="changes-h">
				<h2 id="changes-h" class="h2">
					{stage === 'imported' ? 'Changes made' : 'Changes to make'}
				</h2>
				<div class="table-wrap">
					<table class="data" style="min-width: 420px">
						<thead>
							<tr
								><th></th><th class="num">Create</th><th class="num">Update</th><th class="num"
									>Same</th
								></tr
							>
						</thead>
						<tbody>
							{#each kinds as k (k)}
								<tr>
									<td>{kindLabel[k]}</td>
									<td class="num mono">{c[k].created}</td>
									<td class="num mono">{c[k].updated}</td>
									<td class="num mono muted">{c[k].unchanged}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{/if}

		{#if stage === 'previewed'}
			<form method="POST" action="?/apply" class="btn-group">
				<input type="hidden" name="csv" value={form.csv} />
				<input type="hidden" name="fileName" value={form.fileName} />
				<input type="hidden" name="sha256" value={form.sha256} />
				<button class="btn primary">Import now</button>
				<a href="/import" class="btn">Cancel</a>
			</form>
		{:else if stage === 'imported'}
			<div class="alert ok" role="status">
				Imported. <a href="/releases">View releases</a>
			</div>
		{:else if stage === 'blocked'}
			<div class="alert error" role="alert">
				Fix the errors below in SymphonicMS or the file, then run the dry run again.
			</div>
		{/if}

		{#if form.issues?.length}
			<section class="stack" aria-labelledby="issues-h">
				<h2 id="issues-h" class="h2">Issues</h2>
				<ul class="issues">
					{#each form.issues as i, n (n)}
						<li class="lvl-{i.level}">
							<span class="mono">{i.level === 'error' ? 'Error' : 'Warning'}</span>
							<span class="mono muted">{i.line != null ? `line ${i.line}` : ''}</span>
							<span>{i.message}</span>
						</li>
					{/each}
					{#if form.moreIssues}<li class="muted">… and {form.moreIssues} more</li>{/if}
				</ul>
			</section>
		{/if}
	{/if}

	{#if data.runs.length}
		<section class="stack" aria-labelledby="runs-h">
			<h2 id="runs-h" class="h2">Recent imports</h2>
			<dl class="facts">
				{#each data.runs as r (r.id)}
					<dt class="mono">{when(r.createdAt)}</dt>
					<dd>{r.fileName}</dd>
				{/each}
			</dl>
		</section>
	{/if}
</div>
