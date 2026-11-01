<script lang="ts">
	import Credits from '#lib/components/Credits.svelte';
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
</script>

<pre>&gt; RECORDING :: {rec.isrc}</pre>

{#if data.can.edit}
	<form method="POST" action="?/save" class="grid">
		<input type="hidden" name="updatedAt" value={rec.updatedAt.toISOString()} />
		<label for="title">title</label>
		<input id="title" name="title" value={v('title', rec.title)} required />
		<label for="versionTitle">version</label>
		<input
			id="versionTitle"
			name="versionTitle"
			value={v('versionTitle', rec.versionTitle)}
			placeholder="e.g. Extended Mix"
		/>
		<label for="isrc">isrc</label>
		<input id="isrc" name="isrc" value={v('isrc', rec.isrc)} required />
		<label for="duration">length</label>
		<input
			id="duration"
			name="duration"
			value={v('duration', fmt(rec.durationMs))}
			placeholder="mm:ss"
		/>
		<label for="genre">genre</label>
		<input id="genre" name="genre" value={v('genre', rec.genre)} />
		<label for="subgenre">subgenre</label>
		<input id="subgenre" name="subgenre" value={v('subgenre', rec.subgenre)} />
		<span></span>
		<button>[ save ]</button>
	</form>
	{#if failed('save')}
		<pre class="err">{Object.entries(errors)
				.map(([k, m]) => `! ${k === 'form' ? '' : k + ': '}${m}`)
				.join('\n')}</pre>
	{:else if saved}
		<pre class="ok">&gt; Saved.</pre>
	{/if}
{:else}
	<pre>
TITLE ...... {rec.title}{rec.versionTitle ? ` (${rec.versionTitle})` : ''}
ISRC ....... {rec.isrc}
LENGTH ..... {fmt(rec.durationMs) || '--:--'}
GENRE ...... {[rec.genre, rec.subgenre].filter(Boolean).join(' / ')}</pre>
{/if}

<pre>CREDITS</pre>
<Credits
	credits={data.credits}
	canEdit={data.can.edit}
	canApprove={data.can.approve}
	roles={ROLES}
	errors={failed('addCredit') || failed('removeCredit') || failed('approveCredit') ? errors : {}}
	values={failed('addCredit') ? values : {}}
/>

<pre>ON RELEASES</pre>
<table>
	<tbody>
		{#each data.releases as r (r.id)}
			<tr>
				<td>{r.releaseDate ?? '----------'}</td>
				<td><a href="/releases/{r.id}">{r.title}</a></td>
				<td class="dim">track {r.position}</td>
				<td class="dim">{r.catalogNumber ?? ''}</td>
			</tr>
		{/each}
	</tbody>
</table>

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
	table {
		border-collapse: collapse;
	}
	td {
		padding: 2px 2ch 2px 0;
	}
	.dim {
		color: #8a8a8a;
	}
	.err {
		color: #ff6b6b;
	}
	.ok {
		color: #7cff7c;
	}
</style>
