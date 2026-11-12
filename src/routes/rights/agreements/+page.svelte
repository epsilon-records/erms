<script lang="ts">
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import { page } from '$app/state';
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

	/** A save error that names a field sits under it; the rest go under the form. */
	const FIELDS = [
		'title',
		'counterpartyId',
		'labelId',
		'kind',
		'status',
		'signedOn',
		'startsOn',
		'endsOn',
		'territory',
		'notes'
	];
	const fieldError = (field: string) => (failed ? errors[field] : undefined);
	const invalid = (field: string) =>
		fieldError(field)
			? { 'aria-invalid': true as const, 'aria-describedby': `${field}-error` }
			: {};
	const formErrors = $derived(
		failed
			? Object.entries(errors)
					.filter(([k]) => !FIELDS.includes(k))
					.map(([, m]) => m)
			: []
	);
</script>

{#snippet fieldErrorFor(field: string)}
	{#if fieldError(field)}<Field.Error id="{field}-error">{fieldError(field)}</Field.Error>{/if}
{/snippet}

<svelte:head><title>Agreements · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

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
					<Field.Label for="counterpartyId">Counterparty</Field.Label>
					<NativeSelect.Root
						id="counterpartyId"
						name="counterpartyId"
						value={values.counterpartyId ?? ''}
						required
						{...invalid('counterpartyId')}
					>
						<NativeSelect.Option value="">—</NativeSelect.Option>
						{#each data.options.parties as p (p.id)}<NativeSelect.Option value={p.id}
								>{p.name}</NativeSelect.Option
							>{/each}
					</NativeSelect.Root>
					{@render fieldErrorFor('counterpartyId')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="labelId">Our label</Field.Label>
					<NativeSelect.Root
						id="labelId"
						name="labelId"
						value={values.labelId ?? data.options.labels[0]?.id ?? ''}
						required
						{...invalid('labelId')}
					>
						{#each data.options.labels as l (l.id)}<NativeSelect.Option value={l.id}
								>{l.name}</NativeSelect.Option
							>{/each}
					</NativeSelect.Root>
					{@render fieldErrorFor('labelId')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="kind">Kind</Field.Label>
					<NativeSelect.Root
						id="kind"
						name="kind"
						value={values.kind ?? 'recording'}
						{...invalid('kind')}
					>
						{#each KINDS as k (k)}<NativeSelect.Option value={k}>{k}</NativeSelect.Option>{/each}
					</NativeSelect.Root>
					{@render fieldErrorFor('kind')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="status">Status</Field.Label>
					<NativeSelect.Root
						id="status"
						name="status"
						value={values.status ?? 'draft'}
						{...invalid('status')}
					>
						{#each STATUSES as s (s)}<NativeSelect.Option value={s}>{s}</NativeSelect.Option>{/each}
					</NativeSelect.Root>
					{@render fieldErrorFor('status')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="signedOn">Signed on</Field.Label>
					<Input
						id="signedOn"
						name="signedOn"
						type="date"
						value={values.signedOn ?? ''}
						{...invalid('signedOn')}
					/>
					{@render fieldErrorFor('signedOn')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="startsOn">Starts</Field.Label>
					<Input
						id="startsOn"
						name="startsOn"
						type="date"
						value={values.startsOn ?? ''}
						{...invalid('startsOn')}
					/>
					{@render fieldErrorFor('startsOn')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="endsOn">Ends</Field.Label>
					<Input
						id="endsOn"
						name="endsOn"
						type="date"
						value={values.endsOn ?? ''}
						{...invalid('endsOn')}
					/>
					{@render fieldErrorFor('endsOn')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="territory">Territory</Field.Label>
					<Input
						id="territory"
						name="territory"
						class="w-20 font-mono"
						maxlength={2}
						value={values.territory ?? 'WW'}
						{...invalid('territory')}
					/>
					{@render fieldErrorFor('territory')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="notes">Notes</Field.Label>
					<Input id="notes" name="notes" value={values.notes ?? ''} {...invalid('notes')} />
					{@render fieldErrorFor('notes')}
				</Field.Field>
				<!-- Lines the button up with the controls: the 140 px label column plus the 20 px gap. -->
				<div class="sm:pl-[160px]">
					<Button type="submit" variant="primary">Add agreement</Button>
				</div>
			</Field.Group>
			<p class="soft">
				Uploading the signed copy comes with file storage, together with master uploads.
			</p>
			{#if formErrors.length}
				<div class="alert error" role="alert">{formErrors.join('\n')}</div>
			{:else if created}
				<div class="alert ok" role="status">Agreement added.</div>
			{/if}
		</form>
	{/if}
</div>
