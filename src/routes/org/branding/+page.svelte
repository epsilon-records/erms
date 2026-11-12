<script lang="ts">
	import { page } from '$app/state';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const error = $derived(form && 'error' in form ? form.error : null);
	const field = $derived(form && 'field' in form ? form.field : null);
	// Mark only the input the error is about; an error with no field (e.g. not an owner) marks none.
	const invalid = (name: string) =>
		field === name ? { 'aria-invalid': true, 'aria-describedby': 'branding-error' } : {};
	const displayName = $derived(
		form && 'displayName' in form ? form.displayName : (data.displayName ?? '')
	);
	const accent = $derived(form && 'accent' in form ? form.accent : (data.accent ?? ''));
	const domainError = $derived(
		form && 'domainError' in form ? form.domainError : data.domain.error
	);
	const domainInput = $derived(form && 'domainInput' in form ? form.domainInput : '');
	// The values this form was loaded with. After a validation error, keep the original ones so a
	// change another owner made meanwhile is still caught.
	const seenDisplayName = $derived(
		form && 'seenDisplayName' in form ? form.seenDisplayName : (data.displayName ?? '')
	);
	const seenAccent = $derived(form && 'seenAccent' in form ? form.seenAccent : (data.accent ?? ''));
</script>

<svelte:head><title>Branding · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">Branding</h1>
		<p class="soft">
			How your label looks on its own domain{data.domain.active ? `, ${data.domain.active}` : ''}:
			the name in the header and the browser tab, the accent colour and the tab icon. An empty
			display name shows the label's own name and an empty accent uses LabelKit's. Leaving the icon
			upload empty keeps the current icon; to go back to LabelKit's, tick the box under it.
		</p>
	</section>

	{#if data.saved && !form}
		<div class="alert ok" role="status">Branding saved.</div>
	{/if}
	{#if error}
		<div id="branding-error" class="alert error" role="alert">{error}</div>
	{/if}

	<form method="POST" action="?/save" enctype="multipart/form-data" class="stack">
		<input type="hidden" name="seenDisplayName" value={seenDisplayName} />
		<input type="hidden" name="seenAccent" value={seenAccent} />
		<Field.Field class="max-w-[480px]">
			<Field.Label for="display-name">Display name</Field.Label>
			<Input
				id="display-name"
				name="displayName"
				maxlength={60}
				placeholder={data.name}
				value={displayName}
				{...invalid('displayName')}
			/>
			<Field.Description>Shown instead of “{data.name}”. At most 60 characters.</Field.Description>
		</Field.Field>

		<Field.Field class="max-w-[480px]">
			<Field.Label for="accent">Accent colour</Field.Label>
			<div class="row">
				<Input
					id="accent"
					name="accent"
					maxlength={7}
					placeholder="#c6f432"
					value={accent}
					class="font-mono"
					{...invalid('accent')}
				/>
				{#if data.accent}
					<span class="swatch" style:background={data.accent} aria-hidden="true"></span>
				{/if}
			</div>
			<Field.Description>A hex colour, such as #c6f432.</Field.Description>
		</Field.Field>

		<Field.Field class="max-w-[480px]">
			<Field.Label for="icon">Tab icon</Field.Label>
			{#if data.icon}
				<div class="row">
					<img src={data.icon} alt="Current tab icon" width="32" height="32" class="icon" />
					<span class="soft">Current icon</span>
				</div>
			{/if}
			<Input id="icon" name="icon" type="file" accept="image/png" {...invalid('icon')} />
			<Field.Description>
				A square PNG, {data.iconMin} to {data.iconMax} px, up to 32 KB. It replaces LabelKit's icon in
				the browser tab on your domain.
			</Field.Description>
			{#if data.icon}
				<Field.Field orientation="horizontal" class="w-fit">
					<Checkbox id="remove-icon" name="removeIcon" />
					<Field.Label for="remove-icon">Use LabelKit's icon again</Field.Label>
				</Field.Field>
			{/if}
		</Field.Field>

		<div><Button type="submit" variant="primary">Save branding</Button></div>
	</form>

	<section class="stack" aria-labelledby="domain-title">
		<h2 id="domain-title" class="h2">Your domain</h2>
		<p class="soft">
			Serve LabelKit for your label on a domain you own, such as catalogue.yourlabel.com. Your
			branding, sign-in and tab icon then appear there.
		</p>

		{#if form && 'domainActivated' in form}
			<div class="alert ok" role="status">
				{form.domainActivated} is set up. Its certificate can take a few minutes to issue.
			</div>
		{/if}
		{#if form && 'domainRemoved' in form}
			<div class="alert ok" role="status">Domain removed.</div>
		{/if}
		{#if domainError}
			<div id="domain-error" class="alert error" role="alert">{domainError}</div>
		{/if}

		{#if data.domain.active}
			<p>
				Live on <a href="https://{data.domain.active}">{data.domain.active}</a>.
			</p>
		{/if}

		{#if data.domain.pending && data.domain.dns}
			<div class="stack">
				<p>
					To set up <strong>{data.domain.pending}</strong>, add these records at your DNS provider,
					then check them below.
				</p>
				<div class="table-wrap">
					<table class="data">
						<thead><tr><th>Type</th><th>Name</th><th>Value</th></tr></thead>
						<tbody>
							<tr>
								<td>TXT</td>
								<td><code>{data.domain.dns.txtName}</code></td>
								<td><code>{data.domain.dns.txtValue}</code></td>
							</tr>
							{#if data.domain.dns.apex}
								<tr>
									<td>A</td>
									<td><code>{data.domain.pending}</code></td>
									<td><code>{data.domain.dns.apexA}</code></td>
								</tr>
							{:else}
								<tr>
									<td>CNAME</td>
									<td><code>{data.domain.pending}</code></td>
									<td><code>{data.domain.dns.cname}</code></td>
								</tr>
							{/if}
						</tbody>
					</table>
				</div>
				<p class="soft">
					The TXT record proves the domain is yours; the other record sends its visitors to
					LabelKit.
				</p>
				<div class="row">
					<form method="POST" action="?/verifyDomain">
						<Button type="submit" variant="primary">Check DNS and set up</Button>
					</form>
					<form method="POST" action="?/cancelDomain">
						<Button type="submit" variant="link">Cancel</Button>
					</form>
				</div>
			</div>
		{:else}
			<form method="POST" action="?/requestDomain" class="stack">
				<Field.Field class="max-w-[480px]">
					<Field.Label for="domain"
						>{data.domain.active ? 'Move to another domain' : 'Domain'}</Field.Label
					>
					<Input
						id="domain"
						name="domain"
						placeholder="catalogue.yourlabel.com"
						value={domainInput}
						autocomplete="off"
						aria-invalid={domainError ? true : undefined}
						aria-describedby={domainError ? 'domain-error' : undefined}
					/>
				</Field.Field>
				<div><Button type="submit" variant="primary">Add domain</Button></div>
			</form>
		{/if}

		{#if data.domain.active && !data.domain.pending}
			<form method="POST" action="?/removeDomain">
				<Button type="submit" variant="link">Stop using {data.domain.active}</Button>
			</form>
		{/if}
	</section>
</div>

<style>
	.row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	.swatch {
		width: 1.75rem;
		height: 1.75rem;
		border-radius: 0.375rem;
		border: 1px solid var(--line);
		flex: none;
	}
	.icon {
		border-radius: 0.375rem;
		image-rendering: auto;
	}
</style>
