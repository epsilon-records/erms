<script lang="ts">
	import { page } from '$app/state';
	import {
		confirmRemoval,
		removedIdentities,
		submittedIdentities
	} from '#lib/removal-confirmation.js';
	import Ownership from '#lib/components/Ownership.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const comp = $derived(data.composition);
	const errors = $derived<Record<string, string>>(
		form && 'errors' in form && form.errors ? form.errors : {}
	);
	const values = $derived<Record<string, string>>(
		form && 'values' in form && form.values ? form.values : {}
	);
	const failed = (a: string) => !!form && 'action' in form && form.action === a && !form.ok;
	const ok = (a: string) => !!form && 'action' in form && form.action === a && form.ok;
	const errorText = (e: Record<string, string>) =>
		Object.entries(e)
			.map(([k, m]) => (['form', 'shares', 'writers'].includes(k) ? m : `${k}: ${m}`))
			.join('\n');

	/** A details-save error that names a field sits under it; the rest go under the form. */
	const saveError = (field: string) => (failed('save') ? errors[field] : undefined);
	const invalid = (field: string) =>
		saveError(field) ? { 'aria-invalid': true as const, 'aria-describedby': `${field}-error` } : {};
	const saveFormErrors = $derived(
		failed('save')
			? Object.entries(errors)
					.filter(([k]) => k !== 'title' && k !== 'iswc')
					.map(([, m]) => m)
			: []
	);

	const ROLES = [
		['composer_lyricist', 'Composer & lyricist'],
		['composer', 'Composer'],
		['lyricist', 'Lyricist'],
		['arranger', 'Arranger']
	];
	const WRITER_ROWS = 6;
	const writerValue = (i: number, field: 'writer' | 'role' | 'share') => {
		if (failed('writers')) return values[`${field}_${i}`] ?? '';
		const w = data.writers[i];
		if (!w) return field === 'role' ? 'composer_lyricist' : '';
		return field === 'writer' ? w.partyId : field === 'role' ? w.role : w.share;
	};
	const total = $derived(data.writers.reduce((a, w) => a + Number(w.share), 0));
	const linked = $derived(new Set(data.recordings.map((r) => r.id)));
</script>

<noscript
	><p class="soft">
		JavaScript is required to confirm removals. Removal requests without confirmation leave existing
		records unchanged.
	</p></noscript
>

<svelte:head><title>{comp.title} · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow">
			<a href="/compositions" class="plain">Compositions</a>
			{#if comp.iswc}<span class="mono">{comp.iswc}</span>{/if}
		</div>
		<h1 class="display">{comp.title}</h1>
		{#if data.writers.length}
			<div class="byline">written by {data.writers.map((w) => w.name).join(', ')}</div>
		{/if}
	</section>

	<div class="split">
		<section class="side" aria-labelledby="recs-h">
			<h2 id="recs-h" class="h2">Recordings</h2>
			{#if data.recordings.length === 0}
				<p class="soft">No recordings linked.</p>
			{:else}
				<dl class="facts">
					{#each data.recordings as r (r.id)}
						<dt class="mono">{r.isrc}</dt>
						<dd>
							<a href="/recordings/{r.id}" class="plain" style="font-weight: 600">{r.title}</a
							>{#if r.versionTitle}<span class="muted"> · {r.versionTitle}</span>{/if}
							{#if data.can.write}
								<form
									method="POST"
									action="?/unlink"
									use:confirmRemoval={() =>
										`Unlink ${r.title} from ${comp.title}? This removes their relationship; the recording and composition remain.`}
									style="display: inline"
								>
									<input type="hidden" name="recordingId" value={r.id} />
									<Button type="submit" variant="link" aria-label="Unlink {r.title}">Unlink</Button>
								</form>
							{/if}
						</dd>
					{/each}
				</dl>
			{/if}
			{#if data.recordingChoices}
				<form method="POST" action="?/link" class="stack" style="gap: 8px">
					<label for="link-rec">Link a recording</label>
					<NativeSelect.Root id="link-rec" name="recordingId" required>
						<NativeSelect.Option value="">—</NativeSelect.Option>
						{#each data.recordingChoices.filter((r) => !linked.has(r.id)) as r (r.id)}
							<NativeSelect.Option value={r.id}
								>{r.title}{r.versionTitle ? ` · ${r.versionTitle}` : ''} ({r.isrc})</NativeSelect.Option
							>
						{/each}
					</NativeSelect.Root>
					<div><Button type="submit" size="small">Link</Button></div>
					{#if failed('link') || failed('unlink')}
						<div class="alert error" role="alert">{errorText(errors)}</div>
					{/if}
				</form>
			{/if}
		</section>

		<div class="main">
			{#if data.can.write}
				<form method="POST" action="?/save" class="stack" aria-labelledby="details-h">
					<h2 id="details-h" class="h2">Details</h2>
					<input type="hidden" name="updatedAt" value={comp.updatedAt.toISOString()} />
					<Field.Group class="gap-2.5">
						<Field.Field orientation="responsive">
							<Field.Label for="title">Title</Field.Label>
							<Input
								id="title"
								name="title"
								value={failed('save') ? values.title : comp.title}
								required
								{...invalid('title')}
							/>
							{#if saveError('title')}<Field.Error id="title-error"
									>{saveError('title')}</Field.Error
								>{/if}
						</Field.Field>
						<Field.Field orientation="responsive">
							<Field.Label for="iswc">ISWC</Field.Label>
							<Input
								id="iswc"
								name="iswc"
								class="font-mono"
								value={failed('save') ? values.iswc : (comp.iswc ?? '')}
								placeholder="T-123.456.789-0"
								{...invalid('iswc')}
							/>
							{#if saveError('iswc')}<Field.Error id="iswc-error">{saveError('iswc')}</Field.Error
								>{/if}
						</Field.Field>
						<!-- Lines the button up with the controls: the 140 px label column plus the 20 px gap. -->
						<div class="sm:pl-[160px]">
							<Button type="submit" variant="primary">Save</Button>
						</div>
					</Field.Group>
					{#if saveFormErrors.length}
						<div class="alert error" role="alert">{saveFormErrors.join('\n')}</div>
					{:else if ok('save')}
						<div class="alert ok" role="status">Saved.</div>
					{/if}
				</form>
			{/if}

			<section class="stack" aria-labelledby="writers-h">
				<h2 id="writers-h" class="h2">Writers</h2>
				{#if data.writers.length}
					<div class="table-wrap">
						<table class="data" style="min-width: 420px">
							<thead><tr><th>Writer</th><th>Role</th><th class="num">Split</th></tr></thead>
							<tbody>
								{#each data.writers as w (w.partyId + w.role)}
									<tr>
										<td><a href="/artists/{w.partyId}" class="plain">{w.name}</a></td>
										<td>{ROLES.find(([k]) => k === w.role)?.[1] ?? w.role}</td>
										<td class="num mono">{w.share}%</td>
									</tr>
								{/each}
								{#if total !== 100}
									<tr><td colspan="3" class="soft">Total {total}%</td></tr>
								{/if}
							</tbody>
						</table>
					</div>
				{:else}
					<p class="soft">No writers recorded.</p>
				{/if}

				{#if data.options}
					<form
						method="POST"
						action="?/writers"
						use:confirmRemoval={(fields) => {
							const removed = removedIdentities(
								data.writers,
								submittedIdentities(fields, 'writer'),
								(w) => `${w.partyId}:${w.role}`
							);
							return removed.length
								? `Remove writer roles for ${removed.map((w) => `${w.name} (${w.role})`).join(', ')} from ${comp.title}? Saving removes these entries from the composition's writer set.`
								: null;
						}}
						class="stack"
						aria-label="Edit writers"
					>
						<div class="stack" style="gap: 8px">
							{#each Array.from({ length: WRITER_ROWS }, (_, i) => i) as i (i)}
								<div class="flex flex-wrap items-center gap-2">
									<label for="writer_{i}" class="sr-only">Writer {i + 1}</label>
									<NativeSelect.Root
										id="writer_{i}"
										name="writer_{i}"
										value={writerValue(i, 'writer')}
										wrapperClass="w-[260px]"
									>
										<NativeSelect.Option value="">—</NativeSelect.Option>
										{#each data.options.parties as p (p.id)}<NativeSelect.Option value={p.id}
												>{p.name}</NativeSelect.Option
											>{/each}
									</NativeSelect.Root>
									<label for="role_{i}" class="sr-only">Role {i + 1}</label>
									<NativeSelect.Root
										id="role_{i}"
										name="role_{i}"
										value={writerValue(i, 'role')}
										wrapperClass="w-fit"
									>
										{#each ROLES as [k, l] (k)}<NativeSelect.Option value={k}
												>{l}</NativeSelect.Option
											>{/each}
									</NativeSelect.Root>
									<label for="wshare_{i}" class="sr-only">Split {i + 1} (%)</label>
									<Input
										id="wshare_{i}"
										name="share_{i}"
										class="w-[110px] font-mono"
										inputmode="decimal"
										placeholder="%"
										value={writerValue(i, 'share')}
									/>
								</div>
							{/each}
						</div>
						<p class="soft">Splits replace the current ones and must total 100%.</p>
						<div><Button type="submit" variant="primary">Save writers</Button></div>
						{#if failed('writers')}
							<div class="alert error" role="alert">{errorText(errors)}</div>
						{:else if ok('writers')}
							<div class="alert ok" role="status">Writers saved.</div>
						{/if}
					</form>
				{/if}
			</section>

			{#if data.publishing}
				<section class="stack" aria-labelledby="pub-h">
					<h2 id="pub-h" class="h2">Publishing</h2>
					<Ownership
						groups={data.publishing}
						options={data.options}
						action="setPublishing"
						emptyText="No publishing ownership recorded."
						errors={failed('setPublishing') ? errors : {}}
						values={failed('setPublishing') ? values : {}}
						saved={ok('setPublishing')}
					/>
				</section>
			{/if}
		</div>
	</div>
</div>
