<script lang="ts">
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const failed = $derived(!!form && 'ok' in form && !form.ok);
	const errors = $derived<Record<string, string>>(
		failed && form && 'errors' in form ? (form.errors ?? {}) : {}
	);
	const values = $derived<Record<string, string>>(
		failed && form && 'values' in form ? (form.values ?? {}) : {}
	);
	const created = $derived(!!form && 'ok' in form && form.ok);
	const KINDS = ['recording', 'license', 'publishing', 'remix', 'distribution', 'other'];
	const STATUSES = ['draft', 'active', 'expired', 'terminated'];
</script>

<svelte:head><title>Agreements · ERMS</title></svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow">
				<a href="/rights" class="plain">Rights</a><span>{data.agreements.length}</span>
			</div>
			<h1 class="title">Agreements</h1>
		</div>
	</section>

	{#if data.agreements.length === 0}
		<p class="soft">No agreements yet.</p>
	{:else}
		<div class="table-wrap">
			<table class="data" style="min-width: 820px">
				<thead>
					<tr
						><th>Signed</th><th>Title</th><th>Counterparty</th><th>Kind</th><th>Term</th><th
							>Territory</th
						><th>Status</th><th>Label</th></tr
					>
				</thead>
				<tbody>
					{#each data.agreements as a (a.id)}
						<tr>
							<td class="mono muted">{a.signedOn ?? '—'}</td>
							<td style="font-weight: 600; color: var(--text-strong)">{a.title}</td>
							<td><a href="/artists/{a.counterpartyId}" class="plain">{a.counterparty}</a></td>
							<td>{a.kind}</td>
							<td class="mono muted">{a.startsOn ?? '…'} → {a.endsOn ?? 'open'}</td>
							<td class="mono">{a.territory === 'WW' ? 'Worldwide' : a.territory}</td>
							<td><span class="tag {a.status === 'active' ? '' : 'outline'}">{a.status}</span></td>
							<td class="muted">{a.label}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
	{/if}

	{#if data.options}
		<form method="POST" action="?/create" class="stack" aria-labelledby="new-h">
			<h2 id="new-h" class="h2">New agreement</h2>
			<div class="form-grid">
				<label for="title">Title</label>
				<input id="title" name="title" value={values.title ?? ''} required />
				<label for="counterpartyId">Counterparty</label>
				<select
					id="counterpartyId"
					name="counterpartyId"
					value={values.counterpartyId ?? ''}
					required
				>
					<option value="">—</option>
					{#each data.options.parties as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
				<label for="labelId">Our label</label>
				<select
					id="labelId"
					name="labelId"
					value={values.labelId ?? data.options.labels[0]?.id ?? ''}
					required
				>
					{#each data.options.labels as l (l.id)}<option value={l.id}>{l.name}</option>{/each}
				</select>
				<label for="kind">Kind</label>
				<select id="kind" name="kind" value={values.kind ?? 'recording'}>
					{#each KINDS as k (k)}<option value={k}>{k}</option>{/each}
				</select>
				<label for="status">Status</label>
				<select id="status" name="status" value={values.status ?? 'draft'}>
					{#each STATUSES as s (s)}<option value={s}>{s}</option>{/each}
				</select>
				<label for="signedOn">Signed on</label>
				<input id="signedOn" name="signedOn" type="date" value={values.signedOn ?? ''} />
				<label for="startsOn">Starts</label>
				<input id="startsOn" name="startsOn" type="date" value={values.startsOn ?? ''} />
				<label for="endsOn">Ends</label>
				<input id="endsOn" name="endsOn" type="date" value={values.endsOn ?? ''} />
				<label for="territory">Territory</label>
				<input
					id="territory"
					name="territory"
					class="mono"
					maxlength="2"
					value={values.territory ?? 'WW'}
					style="width: 80px"
				/>
				<label for="notes">Notes</label>
				<input id="notes" name="notes" value={values.notes ?? ''} />
				<span></span>
				<div><button class="btn primary">Add agreement</button></div>
			</div>
			<p class="soft">
				Uploading the signed copy comes with file storage, together with master uploads.
			</p>
			{#if failed}
				<div class="alert error" role="alert">
					{Object.entries(errors)
						.map(([k, m]) => (k === 'form' ? m : `${k}: ${m}`))
						.join('\n')}
				</div>
			{:else if created}
				<div class="alert ok" role="status">Agreement added.</div>
			{/if}
		</form>
	{/if}
</div>
