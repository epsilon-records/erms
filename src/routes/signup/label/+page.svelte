<script lang="ts">
	import { page } from '$app/state';
	import { slugFromName } from '#lib/slug.js';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	// Values come back after a refused submit (the form posts without JavaScript).
	const sent = $derived((form as { values?: { name: string; slug: string } } | null)?.values);
	let name = $derived(sent?.name ?? '');
	let slug = $derived(sent?.slug ?? '');
	let slugEdited = $derived(Boolean(sent?.slug));

	// Suggest the address from the name until the user types their own.
	const suggested = $derived(slugFromName(name));
	const slugValue = $derived(slugEdited ? slug : suggested);
</script>

<div class="container" style="max-width: 480px; padding-top: 12vh">
	<section class="stack">
		<div class="eyebrow"><span>{page.data.brand?.name ?? 'LabelKit'}</span></div>
		<h1 class="form-title">Name your label</h1>
	</section>

	{#if !data.open}
		<div class="alert" role="status">
			You're signed in{data.email ? ` as ${data.email}` : ''}, but you're not a member of any label.
			Ask a label owner to invite you.
		</div>
		<form method="POST" action="/logout"><button class="btn">Log out</button></form>
	{:else}
		<form method="POST" class="stack">
			<label for="name" class="eyebrow">Label name</label>
			<input
				id="name"
				name="name"
				required
				maxlength="120"
				value={name}
				oninput={(e) => (name = e.currentTarget.value)}
			/>

			<label for="slug" class="eyebrow">Address</label>
			<input
				id="slug"
				name="slug"
				required
				maxlength="40"
				value={slugValue}
				oninput={(e) => {
					slugEdited = true;
					slug = e.currentTarget.value;
				}}
			/>
			<p class="soft">Lowercase letters, digits and hyphens.</p>

			<div><button class="btn primary">Create label</button></div>
			{#if form && 'error' in form}
				<div class="alert error" role="alert">{form.error}</div>
			{/if}
		</form>
	{/if}
</div>
