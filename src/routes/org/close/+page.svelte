<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Close label · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">Close this label</h1>
		<p class="soft">
			Closing stops the label for every member straight away. Its catalogue, agreements, consents,
			masters and analysis are deleted 30 days later. Until then an owner can reopen it, or export
			everything from the Export page.
		</p>
		<p><a href="/org/export">Export the catalogue and masters first</a></p>
	</section>

	{#if data.renewing}
		<div class="alert error" role="alert">
			This label is on the Label plan and will renew. <a href="/org/billing"
				>Cancel it on the Billing page</a
			> first.
		</div>
	{/if}
	{#if form?.error}
		<div class="alert error" role="alert">{form.error}</div>
	{/if}

	<form method="POST" class="stack">
		<label>
			Type <strong>{data.orgName}</strong> to confirm
			<input name="confirm" autocomplete="off" required />
		</label>
		<div><button class="btn danger" disabled={data.renewing}>Close label</button></div>
	</form>
</div>
