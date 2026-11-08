<script lang="ts">
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
	let territory = $state('WW');
	$effect.pre(() => {
		if (failedBefore && values.territory) territory = values.territory.toUpperCase();
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
				<input
					id="own-territory"
					name="territory"
					class="mono"
					bind:value={territory}
					maxlength="2"
					style="width: 80px"
					aria-describedby="own-territory-help"
				/>
				<span id="own-territory-help" class="soft" style="margin-left: 8px"
					>WW for worldwide, or a country code</span
				>
			</div>
		</div>
		{#key territory}
			<div class="stack" style="gap: 8px">
				{#each Array.from({ length: ROWS }, (_, i) => i) as i (i)}
					<div class="inline-form">
						<label for="holder_{i}" class="sr-only">Holder {i + 1}</label>
						<select id="holder_{i}" name="holder_{i}" value={rowValue(i, 'holder')}>
							<option value="">—</option>
							<optgroup label="Our labels">
								{#each options.labels as l (l.id)}<option value="l:{l.id}">{l.name}</option>{/each}
							</optgroup>
							<optgroup label="Artists and others">
								{#each options.parties as p (p.id)}<option value="p:{p.id}">{p.name}</option>{/each}
							</optgroup>
						</select>
						<label for="share_{i}" class="sr-only">Share {i + 1} (%)</label>
						<input
							id="share_{i}"
							name="share_{i}"
							class="mono"
							inputmode="decimal"
							placeholder="%"
							value={rowValue(i, 'share')}
							style="width: 110px"
						/>
					</div>
				{/each}
			</div>
		{/key}
		<p class="soft">
			Shares replace this territory's current set and must total 100%. Leave every row blank to
			remove it.
		</p>
		<div><button class="btn primary">Save ownership</button></div>
		{#if failedBefore}
			<div class="alert error" role="alert">
				{Object.entries(errors)
					.map(([k, m]) => (k === 'form' || k === 'shares' ? m : `${k}: ${m}`))
					.join('\n')}
			</div>
		{:else if saved}
			<div class="alert ok" role="status">Ownership saved.</div>
		{/if}
	</form>
{/if}
