<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const c = $derived(data.coverage);
	const pct = $derived(c.total ? Math.floor((c.complete / c.total) * 100) : 0);
	const claimed = $derived(
		form && 'action' in form && form.action === 'claim' && form.ok
			? ((form.result as { count?: number }).count ?? 0)
			: null
	);
	const claimError = $derived(
		form && 'action' in form && form.action === 'claim' && !form.ok && 'errors' in form
			? Object.values(form.errors ?? {}).join(' ')
			: null
	);
</script>

<svelte:head><title>Rights · ERMS</title></svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow"><span>Phase 2 gate</span></div>
			<h1 class="title">Rights</h1>
		</div>
		<nav class="row" aria-label="Rights">
			<a class="btn" href="/rights/agreements">Agreements</a>
			<a class="btn" href="/rights/consents">Consents</a>
		</nav>
	</section>

	<section class="stack" aria-labelledby="coverage-h">
		<h2 id="coverage-h" class="h2">Master ownership</h2>
		<div class="stats">
			<div>
				<span class="value mono">{c.complete}/{c.total}</span><span class="label"
					>recordings with worldwide master ownership</span
				>
			</div>
			<div><span class="value mono">{pct}%</span><span class="label">complete</span></div>
			<div>
				<span class="value mono">{c.missing.length}</span><span class="label">still missing</span>
			</div>
		</div>
		<div class="bar" role="img" aria-label="{pct}% of recordings have master ownership">
			<span style="width: {pct}%"></span>
		</div>
		<p class="soft">
			AudioKit processing needs worldwide master ownership that totals 100% and includes one of your
			labels. Set splits on each recording's page, or claim a label's whole catalog below.
		</p>
	</section>

	{#if data.canWrite}
		<section class="stack" aria-labelledby="claim-h">
			<h2 id="claim-h" class="h2">Claim a label's masters</h2>
			<p class="soft">
				Gives the label 100% worldwide master ownership of every recording on its releases that has
				none yet. Recordings with ownership already recorded are left alone, and every change is
				audited.
			</p>
			<div class="table-wrap">
				<table class="data" style="min-width: 420px">
					<thead><tr><th>Label</th><th class="num">Without ownership</th><th></th></tr></thead>
					<tbody>
						{#each data.labels as l (l.id)}
							<tr>
								<td style="font-weight: 600">{l.name}</td>
								<td class="num mono">{l.open}</td>
								<td class="num">
									{#if l.open > 0}
										<form method="POST" action="?/claim">
											<input type="hidden" name="labelId" value={l.id} />
											<button class="btn small">Claim {l.open}</button>
										</form>
									{:else}<span class="soft">Done</span>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if claimed != null}
				<div class="alert ok" role="status">
					Set ownership on {claimed} recording{claimed === 1 ? '' : 's'}.
				</div>
			{:else if claimError}
				<div class="alert error" role="alert">{claimError}</div>
			{/if}
		</section>
	{/if}

	{#if c.missing.length}
		<section class="stack" aria-labelledby="missing-h">
			<h2 id="missing-h" class="h2">Still missing</h2>
			<div class="table-wrap">
				<table class="data" style="min-width: 520px">
					<thead><tr><th>Recording</th><th>ISRC</th></tr></thead>
					<tbody>
						{#each c.missing.slice(0, 100) as r (r.id)}
							<tr>
								<td>
									<a
										href="/recordings/{r.id}"
										class="plain"
										style="font-weight: 600; color: var(--text-strong)">{r.title}</a
									>{#if r.versionTitle}<span class="muted"> · {r.versionTitle}</span>{/if}
								</td>
								<td class="mono muted">{r.isrc}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			{#if c.missing.length > 100}<p class="soft">Showing 100 of {c.missing.length}.</p>{/if}
		</section>
	{/if}
</div>
