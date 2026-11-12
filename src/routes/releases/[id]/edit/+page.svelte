<script lang="ts">
	import Credits from '#lib/components/Credits.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
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

	/** A save error that names a field, shown under that field; the rest go under the form. */
	const fieldError = (field: string) => (failed('save') ? errors[field] : undefined);
	const invalid = (field: string) =>
		fieldError(field)
			? { 'aria-invalid': true as const, 'aria-describedby': `${field}-error` }
			: {};
	const FIELDS = [
		'title',
		'versionTitle',
		'type',
		'releaseDate',
		'labelId',
		'catalogNumber',
		'upc',
		'genre',
		'subgenre'
	];
	const formErrors = $derived(
		failed('save')
			? Object.entries(errors)
					.filter(([k]) => !FIELDS.includes(k))
					.map(([, m]) => m)
			: []
	);

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

{#snippet error(field: string)}
	{#if fieldError(field)}<Field.Error id="{field}-error">{fieldError(field)}</Field.Error>{/if}
{/snippet}

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
		<Field.Group class="gap-2.5">
			<Field.Field orientation="responsive">
				<Field.Label for="title">Title</Field.Label>
				<Input id="title" name="title" value={v('title', r.title)} required {...invalid('title')} />
				{@render error('title')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="versionTitle">Version</Field.Label>
				<Input
					id="versionTitle"
					name="versionTitle"
					value={v('versionTitle', r.versionTitle)}
					{...invalid('versionTitle')}
				/>
				{@render error('versionTitle')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="type">Type</Field.Label>
				<NativeSelect.Root id="type" name="type" value={v('type', r.type)} {...invalid('type')}>
					{#each TYPES as t (t)}<NativeSelect.Option value={t}>{t}</NativeSelect.Option>{/each}
				</NativeSelect.Root>
				{@render error('type')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="releaseDate">Release date</Field.Label>
				<Input
					id="releaseDate"
					name="releaseDate"
					value={v('releaseDate', r.releaseDate)}
					placeholder="YYYY-MM-DD"
					{...invalid('releaseDate')}
				/>
				{@render error('releaseDate')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="labelId">Label</Field.Label>
				<NativeSelect.Root
					id="labelId"
					name="labelId"
					value={v('labelId', r.labelId)}
					{...invalid('labelId')}
				>
					{#each data.labels as l (l.id)}
						<NativeSelect.Option value={l.id}>{l.name}</NativeSelect.Option>
					{/each}
				</NativeSelect.Root>
				{@render error('labelId')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="catalogNumber">Catalog #</Field.Label>
				<Input
					id="catalogNumber"
					name="catalogNumber"
					class="font-mono"
					value={v('catalogNumber', r.catalogNumber)}
					{...invalid('catalogNumber')}
				/>
				{@render error('catalogNumber')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="upc">UPC</Field.Label>
				<Input
					id="upc"
					name="upc"
					class="font-mono"
					value={v('upc', r.upc)}
					required
					{...invalid('upc')}
				/>
				{@render error('upc')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="genre">Genre</Field.Label>
				<Input id="genre" name="genre" value={v('genre', r.genre)} {...invalid('genre')} />
				{@render error('genre')}
			</Field.Field>
			<Field.Field orientation="responsive">
				<Field.Label for="subgenre">Subgenre</Field.Label>
				<Input
					id="subgenre"
					name="subgenre"
					value={v('subgenre', r.subgenre)}
					{...invalid('subgenre')}
				/>
				{@render error('subgenre')}
			</Field.Field>
			<!-- Lines the buttons up with the controls: the 140 px label column plus the 20 px gap. -->
			<div class="btn-group sm:pl-[160px]">
				<Button type="submit" variant="primary">Save</Button>
				<a href="/releases/{r.id}" class="btn">Cancel</a>
			</div>
		</Field.Group>
		{#if formErrors.length}
			<div class="alert error" role="alert">{formErrors.join('\n')}</div>
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
