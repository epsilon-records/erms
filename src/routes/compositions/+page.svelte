<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	let q = $state('');
	const filtered = $derived(
		data.compositions.filter(
			(c) =>
				!q ||
				`${c.title} ${c.iswc ?? ''} ${c.writers ?? ''}`.toLowerCase().includes(q.toLowerCase())
		)
	);
	const errors = $derived<Record<string, string>>(
		form && 'errors' in form && form.errors ? form.errors : {}
	);
	const values = $derived<Record<string, string>>(
		form && 'values' in form && form.values ? form.values : {}
	);
</script>

<svelte:head><title>Compositions · ERMS</title></svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow"><span>{filtered.length} of {data.compositions.length}</span></div>
			<h1 class="title">Compositions</h1>
		</div>
		<div style="width: 320px; max-width: 100%">
			<label for="filter" class="sr-only">Filter compositions</label>
			<input id="filter" bind:value={q} placeholder="Filter by title, ISWC, writer" />
		</div>
	</section>

	{#if data.compositions.length === 0}
		<p class="soft">
			No compositions yet. A composition is the song itself: its writers and publishers. Add one
			here or from a recording's page.
		</p>
	{:else}
		<div class="table-wrap">
			<table class="data" style="min-width: 620px">
				<thead>
					<tr><th>Title</th><th>ISWC</th><th>Writers</th><th class="num">Recordings</th></tr>
				</thead>
				<tbody>
					{#each filtered as c (c.id)}
						<tr>
							<td>
								<a
									href="/compositions/{c.id}"
									class="plain"
									style="font-weight: 600; color: var(--text-strong)">{c.title}</a
								>
							</td>
							<td class="mono muted">{c.iswc ?? '—'}</td>
							<td>{c.writers ?? '—'}</td>
							<td class="num mono">{c.recordings}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if data.canWrite}
		<form method="POST" action="?/create" class="stack" aria-labelledby="new-h">
			<h2 id="new-h" class="h2">New composition</h2>
			<div class="form-grid">
				<label for="title">Title</label>
				<input id="title" name="title" value={values.title ?? ''} required />
				<label for="iswc">ISWC</label>
				<input
					id="iswc"
					name="iswc"
					class="mono"
					value={values.iswc ?? ''}
					placeholder="T-123.456.789-0 (optional)"
				/>
				<span></span>
				<div><button class="btn primary">Add composition</button></div>
			</div>
			{#if Object.keys(errors).length}
				<div class="alert error" role="alert">
					{Object.entries(errors)
						.map(([k, m]) => (k === 'form' ? m : `${k}: ${m}`))
						.join('\n')}
				</div>
			{/if}
		</form>
	{/if}
</div>
