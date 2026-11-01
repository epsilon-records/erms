<script lang="ts">
	import Credits from '#lib/components/Credits.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const r = $derived(data.release);
	const errors = $derived<Record<string, string>>(
		form && 'errors' in form && form.errors ? form.errors : {}
	);
	const values = $derived<Record<string, string>>(
		form && 'values' in form && form.values ? form.values : {}
	);
	const failed = (a: string) => form && 'action' in form && form.action === a && !form.ok;
	const v = (field: string, fallback: string | null) =>
		failed('save') ? (values[field] ?? '') : (fallback ?? '');

	const TYPES = ['single', 'ep', 'album', 'compilation'];
	const artistCredits = $derived(
		r.artists.map((a) => ({
			id: a.creditId,
			role: 'main',
			name: a.name,
			partyId: a.id,
			approvedAt: a.approvedAt
		}))
	);
</script>

<div class="container">
	<section class="stack">
		<div class="eyebrow">
			<a href="/releases/{r.id}" class="plain muted">← {r.title}</a>
			<span class="tag outline">Editing</span>
		</div>
		<h1 class="title">Edit release</h1>
	</section>

	<form method="POST" action="?/save" class="stack">
		<input type="hidden" name="updatedAt" value={r.updatedAt.toISOString()} />
		<div class="form-grid">
			<label for="title">Title</label>
			<input id="title" name="title" value={v('title', r.title)} required />
			<label for="versionTitle">Version</label>
			<input id="versionTitle" name="versionTitle" value={v('versionTitle', r.versionTitle)} />
			<label for="type">Type</label>
			<select id="type" name="type">
				{#each TYPES as t (t)}<option value={t} selected={v('type', r.type) === t}>{t}</option
					>{/each}
			</select>
			<label for="releaseDate">Release date</label>
			<input
				id="releaseDate"
				name="releaseDate"
				value={v('releaseDate', r.releaseDate)}
				placeholder="YYYY-MM-DD"
			/>
			<label for="labelId">Label</label>
			<select id="labelId" name="labelId">
				{#each data.labels as l (l.id)}
					<option value={l.id} selected={v('labelId', r.labelId) === l.id}>{l.name}</option>
				{/each}
			</select>
			<label for="catalogNumber">Catalog #</label>
			<input
				id="catalogNumber"
				name="catalogNumber"
				class="mono"
				value={v('catalogNumber', r.catalogNumber)}
			/>
			<label for="upc">UPC</label>
			<input id="upc" name="upc" class="mono" value={v('upc', r.upc)} required />
			<label for="genre">Genre</label>
			<input id="genre" name="genre" value={v('genre', r.genre)} />
			<label for="subgenre">Subgenre</label>
			<input id="subgenre" name="subgenre" value={v('subgenre', r.subgenre)} />
			<span></span>
			<div class="btn-group">
				<button class="btn primary">Save</button>
				<a href="/releases/{r.id}" class="btn">Cancel</a>
			</div>
		</div>
		{#if failed('save')}
			<div class="alert error" role="alert">
				{Object.entries(errors)
					.map(([k, m]) => (k === 'form' ? m : `${k}: ${m}`))
					.join('\n')}
			</div>
		{/if}
	</form>

	<section class="stack" aria-labelledby="artists-h">
		<h2 id="artists-h" class="h2">Release artists</h2>
		<Credits
			credits={artistCredits}
			canEdit={true}
			canApprove={data.can.approve}
			roles={['main']}
			errors={failed('addCredit') || failed('removeCredit') || failed('approveCredit')
				? errors
				: {}}
			values={failed('addCredit') ? values : {}}
		/>
		<p class="muted" style="margin: 0; font-size: 13px">
			Track titles, ISRCs and track credits are edited on each recording's page.
		</p>
	</section>
</div>
