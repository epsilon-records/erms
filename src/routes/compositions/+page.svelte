<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { page } from '$app/state';
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

	/** A save error that names a field sits under it; the rest go under the form. */
	const FIELDS = ['title', 'iswc'];
	const fieldError = (field: string) =>
		Object.keys(errors).length > 0 ? errors[field] : undefined;
	const invalid = (field: string) =>
		fieldError(field)
			? { 'aria-invalid': true as const, 'aria-describedby': `${field}-error` }
			: {};
	const formErrors = $derived(
		Object.keys(errors).length > 0
			? Object.entries(errors)
					.filter(([k]) => !FIELDS.includes(k))
					.map(([, m]) => m)
			: []
	);
</script>

{#snippet fieldErrorFor(field: string)}
	{#if fieldError(field)}<Field.Error id="{field}-error">{fieldError(field)}</Field.Error>{/if}
{/snippet}

<svelte:head><title>Compositions · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow"><span>{filtered.length} of {data.compositions.length}</span></div>
			<h1 class="title">Compositions</h1>
		</div>
		<div style="width: 320px; max-width: 100%">
			<label for="filter" class="sr-only">Filter compositions</label>
			<Input id="filter" bind:value={q} placeholder="Filter by title, ISWC, writer" />
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
			<Field.Group class="gap-2.5">
				<Field.Field orientation="responsive">
					<Field.Label for="title">Title</Field.Label>
					<Input
						id="title"
						name="title"
						value={values.title ?? ''}
						required
						{...invalid('title')}
					/>
					{@render fieldErrorFor('title')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="iswc">ISWC</Field.Label>
					<Input
						id="iswc"
						name="iswc"
						class="font-mono"
						value={values.iswc ?? ''}
						placeholder="T-123.456.789-0 (optional)"
						{...invalid('iswc')}
					/>
					{@render fieldErrorFor('iswc')}
				</Field.Field>
				<!-- Lines the button up with the controls: the 140 px label column plus the 20 px gap. -->
				<div class="sm:pl-[160px]">
					<Button type="submit" variant="primary">Add composition</Button>
				</div>
			</Field.Group>
			{#if formErrors.length}
				<div class="alert error" role="alert">{formErrors.join('\n')}</div>
			{/if}
		</form>
	{/if}
</div>
