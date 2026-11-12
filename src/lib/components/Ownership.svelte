<script lang="ts">
	import { untrack } from 'svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as NativeSelect from '#lib/components/ui/native-select/index.js';
	import {
		confirmRemoval,
		removedIdentities,
		submittedIdentities
	} from '#lib/removal-confirmation.js';
	/**
	 * Shows ownership by territory and, for rights roles, edits one territory's set of
	 * shares. Rows are holder_N / share_N fields; blank rows are ignored.
	 */
	type Group = {
		territory: string;
		holders: { holder: string; name: string; isLabel: boolean; share: string }[];
	};
	type Option = { id: string; name: string };

	let {
		groups,
		options = null,
		action,
		emptyText = 'No master ownership recorded. AudioKit processing stays blocked until worldwide ownership totals 100%.',
		errors = {},
		values = {},
		saved = false
	}: {
		groups: Group[];
		options?: { labels: Option[]; parties: Option[] } | null;
		action: string;
		emptyText?: string;
		errors?: Record<string, string>;
		values?: Record<string, string>;
		saved?: boolean;
	} = $props();

	const failedBefore = $derived(Object.keys(errors).length > 0);
	// SSR must restore failed submissions too; effects only run after hydration.
	let territory = $state(
		untrack(() => (failedBefore ? (values.territory || 'WW').toUpperCase() : 'WW'))
	);
	$effect.pre(() => {
		if (failedBefore) territory = (values.territory || 'WW').toUpperCase();
	});
	const current = $derived(
		groups.find((g) => g.territory === territory.trim().toUpperCase())?.holders ?? []
	);
	const ROWS = 6;
	const rowValue = (i: number, field: 'holder' | 'share') => {
		if (
			failedBefore &&
			territory.trim().toUpperCase() === (values.territory || 'WW').trim().toUpperCase()
		)
			return values[`${field}_${i}`] ?? '';
		const h = current[i];
		return h ? (field === 'holder' ? h.holder : h.share) : '';
	};
	const total = (g: Group) => g.holders.reduce((a, h) => a + Number(h.share), 0);
	/** Errors shown under the form; a territory error sits under its own input instead. */
	const formErrors = $derived(
		Object.entries(errors)
			.filter(([k]) => k !== 'territory')
			.map(([k, m]) => (k === 'form' || k === 'shares' ? m : `${k}: ${m}`))
	);
</script>

<noscript
	><p class="soft">
		JavaScript is required to confirm removals. Removal requests without confirmation leave existing
		records unchanged.
	</p></noscript
>

{#if groups.length === 0}
	<p class="soft">{emptyText}</p>
{:else}
	<div class="table-wrap">
		<table class="data" style="min-width: 420px">
			<thead>
				<tr><th>Territory</th><th>Holder</th><th class="num">Share</th></tr>
			</thead>
			<tbody>
				{#each groups as g (g.territory)}
					{#each g.holders as h, i (h.holder)}
						<tr>
							<td class="mono"
								>{i === 0 ? (g.territory === 'WW' ? 'Worldwide' : g.territory) : ''}</td
							>
							<td>
								{h.name}{#if h.isLabel}<span class="tag outline" style="margin-left: 8px"
										>label</span
									>{/if}
							</td>
							<td class="num mono">{h.share}%</td>
						</tr>
					{/each}
					{#if total(g) !== 100}
						<tr><td></td><td colspan="2" class="soft">Total {total(g)}%</td></tr>
					{/if}
				{/each}
			</tbody>
		</table>
	</div>
{/if}

{#if options}
	<form
		method="POST"
		action="?/{action}"
		use:confirmRemoval={(fields) => {
			const selected = (fields.territory || 'WW').trim().toUpperCase();
			const removed = removedIdentities(
				groups.find((g) => g.territory === selected)?.holders ?? [],
				submittedIdentities(fields, 'holder'),
				(h) => h.holder
			);
			return removed.length
				? `Remove ownership for ${removed.map((h) => h.name).join(', ')} in ${selected}? Saving removes these holders from this territory's ownership set.`
				: null;
		}}
		class="stack"
		aria-label="Edit ownership"
	>
		<div class="form-grid">
			<label for="own-territory">Territory</label>
			<div>
				<Input
					id="own-territory"
					name="territory"
					class="w-20 font-mono"
					bind:value={territory}
					maxlength={2}
					aria-invalid={errors.territory ? true : undefined}
					aria-describedby={errors.territory
						? 'own-territory-help own-territory-error'
						: 'own-territory-help'}
				/>
				<span id="own-territory-help" class="soft" style="margin-left: 8px"
					>WW for worldwide, or a country code</span
				>
				{#if errors.territory}<Field.Error id="own-territory-error">{errors.territory}</Field.Error
					>{/if}
			</div>
		</div>
		{#key territory}
			<div class="stack" style="gap: 8px">
				{#each Array.from({ length: ROWS }, (_, i) => i) as i (i)}
					<div class="flex flex-wrap items-center gap-2">
						<label for="holder_{i}" class="sr-only">Holder {i + 1}</label>
						<NativeSelect.Root
							id="holder_{i}"
							name="holder_{i}"
							value={rowValue(i, 'holder')}
							wrapperClass="w-[260px]"
						>
							<NativeSelect.Option value="">—</NativeSelect.Option>
							<NativeSelect.OptGroup label="Our labels">
								{#each options.labels as l (l.id)}<NativeSelect.Option value="l:{l.id}"
										>{l.name}</NativeSelect.Option
									>{/each}
							</NativeSelect.OptGroup>
							<NativeSelect.OptGroup label="Artists and others">
								{#each options.parties as p (p.id)}<NativeSelect.Option value="p:{p.id}"
										>{p.name}</NativeSelect.Option
									>{/each}
							</NativeSelect.OptGroup>
						</NativeSelect.Root>
						<label for="share_{i}" class="sr-only">Share {i + 1} (%)</label>
						<Input
							id="share_{i}"
							name="share_{i}"
							class="w-[110px] font-mono"
							inputmode="decimal"
							placeholder="%"
							value={rowValue(i, 'share')}
						/>
					</div>
				{/each}
			</div>
		{/key}
		<p class="soft">
			Shares replace this territory's current set and must total 100%. Leave every row blank to
			remove it.
		</p>
		<div><Button type="submit" variant="primary">Save ownership</Button></div>
		{#if formErrors.length}
			<div class="alert error" role="alert">{formErrors.join('\n')}</div>
		{:else if saved}
			<div class="alert ok" role="status">Ownership saved.</div>
		{/if}
	</form>
{/if}
