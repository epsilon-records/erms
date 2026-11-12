<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>Label closed · {page.data.brand?.name ?? 'LabelKit'}</title></svelte:head>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span>{data.orgName}</span></div>
		<h1 class="title">This label is closed</h1>
		<p class="soft">
			{#if data.purgeAfter}
				Its data will be deleted on {data.purgeAfter}.
			{:else}
				Its data will be deleted soon.
			{/if}
			{#if !data.isOwner}
				Ask an owner if you think this is a mistake.
			{/if}
		</p>
	</section>

	{#if form?.error}
		<div class="alert error" role="alert">{form.error}</div>
	{/if}

	{#if data.isOwner}
		<section class="stack">
			<p><a class="btn" href="/org/export">Export the catalogue and masters</a></p>
			<form method="POST" action="?/reopen">
				<button class="btn primary">Reopen the label</button>
			</form>
		</section>
	{/if}

	{#if data.others.length}
		<form method="POST" action="/org" class="stack">
			<label>
				Switch to another label
				<select name="orgId">
					{#each data.others as o (o.orgId)}<option value={o.orgId}>{o.orgName}</option>{/each}
				</select>
			</label>
			<div><button class="btn">Switch</button></div>
		</form>
	{/if}
</div>
