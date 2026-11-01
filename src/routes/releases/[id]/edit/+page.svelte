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

<pre><a href="/releases/{r.id}">&lt; {r.title}</a></pre>
<pre>&gt; EDIT RELEASE</pre>

<form method="POST" action="?/save" class="grid">
	<input type="hidden" name="updatedAt" value={r.updatedAt.toISOString()} />
	<label for="title">title</label>
	<input id="title" name="title" value={v('title', r.title)} required />
	<label for="versionTitle">version</label>
	<input id="versionTitle" name="versionTitle" value={v('versionTitle', r.versionTitle)} />
	<label for="type">type</label>
	<select id="type" name="type">
		{#each TYPES as t}<option value={t} selected={v('type', r.type) === t}>{t}</option>{/each}
	</select>
	<label for="releaseDate">date</label>
	<input
		id="releaseDate"
		name="releaseDate"
		value={v('releaseDate', r.releaseDate)}
		placeholder="YYYY-MM-DD"
	/>
	<label for="labelId">label</label>
	<select id="labelId" name="labelId">
		{#each data.labels as l (l.id)}
			<option value={l.id} selected={v('labelId', r.labelId) === l.id}>{l.name}</option>
		{/each}
	</select>
	<label for="catalogNumber">cat#</label>
	<input id="catalogNumber" name="catalogNumber" value={v('catalogNumber', r.catalogNumber)} />
	<label for="upc">upc</label>
	<input id="upc" name="upc" value={v('upc', r.upc)} required />
	<label for="genre">genre</label>
	<input id="genre" name="genre" value={v('genre', r.genre)} />
	<label for="subgenre">subgenre</label>
	<input id="subgenre" name="subgenre" value={v('subgenre', r.subgenre)} />
	<span></span>
	<span>
		<button>[ save ]</button>
		<a href="/releases/{r.id}">[ cancel ]</a>
	</span>
</form>
{#if failed('save')}
	<pre class="err">{Object.entries(errors)
			.map(([k, m]) => `! ${k === 'form' ? '' : k + ': '}${m}`)
			.join('\n')}</pre>
{/if}

<pre>RELEASE ARTISTS</pre>
<Credits
	credits={artistCredits}
	canEdit={true}
	canApprove={data.can.approve}
	roles={['main']}
	errors={failed('addCredit') || failed('removeCredit') || failed('approveCredit') ? errors : {}}
	values={failed('addCredit') ? values : {}}
/>

<pre class="dim">Track titles, ISRCs and track credits are edited on each recording's page.</pre>

<style>
	.grid {
		display: grid;
		grid-template-columns: 10ch minmax(0, 48ch);
		gap: 4px 1ch;
		align-items: center;
	}
	.grid label {
		color: #8a8a8a;
	}
	.dim {
		color: #8a8a8a;
	}
	.err {
		color: #ff6b6b;
	}
</style>
