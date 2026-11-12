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
		failed && form && 'values' in form && form.action === 'grant' ? (form.values ?? {}) : {}
	);
	const done = $derived(!!form && 'ok' in form && form.ok ? form.action : null);
	const PURPOSES = [
		['analysis', 'Analysis'],
		['transcode', 'Transcode and previews'],
		['stem_separation', 'Stem separation'],
		['mastering', 'Mastering'],
		['voice', 'Voice tools'],
		['generation', 'Generation']
	];
	const label = (p: string) => PURPOSES.find(([k]) => k === p)?.[1] ?? p;
	const state = (c: (typeof data.consents)[number]) =>
		c.revokedAt
			? 'revoked'
			: c.grantedOn > data.today
				? 'not yet'
				: c.expiresOn && c.expiresOn < data.today
					? 'expired'
					: 'active';

	/** A save error that names a field sits under it; the rest go under the form. */
	const FIELDS = [
		'partyId',
		'purpose',
		'recordingId',
		'agreementId',
		'grantedOn',
		'expiresOn',
		'notes'
	];
	const fieldError = (field: string) =>
		failed && form?.action === 'grant' ? errors[field] : undefined;
	const invalid = (field: string) =>
		fieldError(field)
			? { 'aria-invalid': true as const, 'aria-describedby': `${field}-error` }
			: {};
	const formErrors = $derived(
		failed && form?.action === 'grant'
			? Object.entries(errors)
					.filter(([k]) => !FIELDS.includes(k))
					.map(([, m]) => m)
			: []
	);
</script>

{#snippet fieldErrorFor(field: string)}
	{#if fieldError(field)}<Field.Error id="{field}-error">{fieldError(field)}</Field.Error>{/if}
{/snippet}

<svelte:head><title>Consents · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="spread">
		<div class="stack">
			<div class="eyebrow">
				<a href="/rights" class="plain">Rights</a><span>{data.consents.length}</span>
			</div>
			<h1 class="title">Consents</h1>
		</div>
	</section>
	<p class="soft">
		Voice and generation need consent from every main artist on a recording. Stem separation and
		mastering need it when your labels don't own the whole master. A consent with no recording
		covers every recording that credits the person.
	</p>

	{#if data.consents.length}
		<div class="table-wrap">
			<table class="data" style="min-width: 780px">
				<thead>
					<tr
						><th>From</th><th>For</th><th>Covers</th><th>Granted</th><th>Expires</th><th>State</th
						><th></th></tr
					>
				</thead>
				<tbody>
					{#each data.consents as c (c.id)}
						<tr>
							<td
								><a href="/artists/{c.partyId}" class="plain" style="font-weight: 600">{c.party}</a
								></td
							>
							<td>{label(c.purpose)}</td>
							<td>
								{#if c.recordingId}<a href="/recordings/{c.recordingId}" class="plain"
										>{c.recording}</a
									>{#if c.recordingVersion}<span class="muted">
											· {c.recordingVersion}</span
										>{/if}{:else}<span class="muted">All their recordings</span>{/if}
							</td>
							<td class="mono muted">{c.grantedOn}</td>
							<td class="mono muted">{c.expiresOn ?? '—'}</td>
							<td><span class="tag {state(c) === 'active' ? '' : 'outline'}">{state(c)}</span></td>
							<td class="num">
								{#if data.options && !c.revokedAt}
									<!-- Decision 0023: a native disclosure, so the confirm step works without JS. -->
									<details class="confirm">
										<summary class="btn small danger" aria-label="Revoke {c.party}’s consent"
											>Revoke</summary
										>
										<form method="POST" action="?/revoke" class="confirm-panel">
											<input type="hidden" name="consentId" value={c.id} />
											<p>
												Revoke {c.party}’s consent for {label(c.purpose).toLowerCase()}? Jobs that
												need it are refused from now on. Recording it again makes a new consent.
											</p>
											<Button
												type="submit"
												variant="danger"
												size="small"
												name="removalConfirmed"
												value="yes"
												aria-label="Confirm: revoke {c.party}’s consent">Revoke consent</Button
											>
										</form>
									</details>
								{/if}
							</td>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>
		{#if failed && form?.action === 'revoke'}
			<div class="alert error" role="alert">{Object.values(errors).join('\n')}</div>
		{/if}
	{:else}
		<p class="soft">No consents recorded.</p>
	{/if}

	{#if data.options}
		<form method="POST" action="?/grant" class="stack" aria-labelledby="grant-h">
			<h2 id="grant-h" class="h2">Record a consent</h2>
			<Field.Group class="gap-2.5">
				<Field.Field orientation="responsive">
					<Field.Label for="partyId">From</Field.Label>
					<NativeSelect.Root
						id="partyId"
						name="partyId"
						value={values.partyId ?? ''}
						required
						{...invalid('partyId')}
					>
						<NativeSelect.Option value="">—</NativeSelect.Option>
						{#each data.options.parties as p (p.id)}<NativeSelect.Option value={p.id}
								>{p.name}</NativeSelect.Option
							>{/each}
					</NativeSelect.Root>
					{@render fieldErrorFor('partyId')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="purpose">For</Field.Label>
					<NativeSelect.Root
						id="purpose"
						name="purpose"
						value={values.purpose ?? 'stem_separation'}
						{...invalid('purpose')}
					>
						{#each PURPOSES as [k, l] (k)}<NativeSelect.Option value={k}>{l}</NativeSelect.Option
							>{/each}
					</NativeSelect.Root>
					{@render fieldErrorFor('purpose')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="recordingId">Recording ID</Field.Label>
					<Input
						id="recordingId"
						name="recordingId"
						class="font-mono"
						value={values.recordingId ?? ''}
						placeholder="Blank for all their recordings"
						{...invalid('recordingId')}
					/>
					{@render fieldErrorFor('recordingId')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="agreementId">Agreement</Field.Label>
					<NativeSelect.Root
						id="agreementId"
						name="agreementId"
						value={values.agreementId ?? ''}
						{...invalid('agreementId')}
					>
						<NativeSelect.Option value="">—</NativeSelect.Option>
						{#each data.agreements ?? [] as a (a.id)}<NativeSelect.Option value={a.id}
								>{a.title}</NativeSelect.Option
							>{/each}
					</NativeSelect.Root>
					{@render fieldErrorFor('agreementId')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="grantedOn">Granted on</Field.Label>
					<Input
						id="grantedOn"
						name="grantedOn"
						type="date"
						value={values.grantedOn ?? data.today}
						required
						{...invalid('grantedOn')}
					/>
					{@render fieldErrorFor('grantedOn')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="expiresOn">Expires</Field.Label>
					<Input
						id="expiresOn"
						name="expiresOn"
						type="date"
						value={values.expiresOn ?? ''}
						{...invalid('expiresOn')}
					/>
					{@render fieldErrorFor('expiresOn')}
				</Field.Field>
				<Field.Field orientation="responsive">
					<Field.Label for="notes">Notes</Field.Label>
					<Input id="notes" name="notes" value={values.notes ?? ''} {...invalid('notes')} />
					{@render fieldErrorFor('notes')}
				</Field.Field>
				<!-- Lines the button up with the controls: the 140 px label column plus the 20 px gap. -->
				<div class="sm:pl-[160px]">
					<Button type="submit" variant="primary">Record consent</Button>
				</div>
			</Field.Group>
			{#if formErrors.length}
				<div class="alert error" role="alert">{formErrors.join('\n')}</div>
			{:else if done === 'grant'}
				<div class="alert ok" role="status">Consent recorded.</div>
			{:else if done === 'revoke'}
				<div class="alert ok" role="status">Consent revoked.</div>
			{/if}
		</form>
	{/if}
</div>

<style>
	.confirm {
		display: inline-block;
		text-align: left;
	}
	.confirm > summary {
		list-style: none;
	}
	.confirm > summary::-webkit-details-marker {
		display: none;
	}
	.confirm[open] > summary {
		border-color: var(--danger);
	}
	.confirm-panel {
		display: grid;
		gap: 8px;
		justify-items: start;
		max-width: 300px;
		margin-top: 8px;
		padding: 10px 12px;
		border-left: 2px solid var(--danger);
		background: var(--surface);
		font-size: 13px;
	}
	.confirm-panel p {
		margin: 0;
	}
</style>
