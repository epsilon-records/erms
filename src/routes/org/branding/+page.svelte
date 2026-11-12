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
</script>

<svelte:head><title>Branding · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">Branding</h1>
		<p class="soft">
			How your label looks on its own domain{data.customDomain ? `, ${data.customDomain}` : ''}: the
			name in the header and the browser tab, the accent colour and the tab icon. Leave a field
			empty to use LabelKit's.
		</p>
		{#if !data.customDomain}
			<p class="soft">
				Your label has no domain of its own yet, so these show once one is set up. To serve LabelKit
				on your own domain, contact us: it needs DNS and a certificate.
			</p>
		{/if}
	</section>

	{#if form && 'saved' in form && form.saved}
		<div class="alert ok" role="status">Branding saved.</div>
	{/if}
	{#if error}
		<div id="branding-error" class="alert error" role="alert">{error}</div>
	{/if}

	<form method="POST" enctype="multipart/form-data" class="stack">
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
