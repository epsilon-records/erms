<script lang="ts">
	import PublicAnalytics from '#lib/components/PublicAnalytics.svelte';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const badLink = $derived(page.url.searchParams.get('link') === 'invalid');
</script>

<PublicAnalytics />

<div class="container" style="max-width: 480px; padding-top: 12vh">
	<section class="stack">
		<div class="eyebrow"><span>{page.data.brand?.name ?? 'LabelKit'}</span></div>
		<h1 class="display">Log in</h1>
	</section>

	{#if form && 'sent' in form}
		<div class="alert ok" role="status">
			If {form.sent} has an account, a login link is on its way. Check your inbox.
		</div>
	{:else}
		{#if badLink && !form}
			<div class="alert error" role="alert">
				That login link has expired or was already used. Request a new one.
			</div>
		{/if}
		<form method="POST" action="/login" class="stack">
			<label for="email" class="eyebrow">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" required />
			<div><button class="btn primary">Send login link</button></div>
			{#if form && 'error' in form}
				<div class="alert error" role="alert">{form.error}</div>
			{/if}
		</form>
		{#if data.signupOpen}
			<p class="soft">New label? <a href="/signup">Create an account</a></p>
		{/if}
	{/if}
</div>
