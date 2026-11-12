<script lang="ts">
	import PublicAnalytics from '#lib/components/PublicAnalytics.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const badLink = $derived(page.url.searchParams.get('link') === 'invalid');
	const error = $derived(form && 'error' in form ? form.error : null);
</script>

<PublicAnalytics />

<div class="container" style="max-width: 480px; padding-top: 12vh">
	<section class="stack">
		<div class="eyebrow"><span>{page.data.brand?.name ?? 'LabelKit'}</span></div>
		<h1 class="form-title">Log in</h1>
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
			<!-- gap-4: the label sits where it did before the migration. -->
			<Field.Field class="gap-4">
				<Field.Label for="email" class="font-mono">Email</Field.Label>
				<Input
					id="email"
					name="email"
					type="email"
					autocomplete="email"
					required
					aria-invalid={error ? true : undefined}
					aria-describedby={error ? 'login-error' : undefined}
				/>
			</Field.Field>
			<div><Button type="submit" variant="primary">Send login link</Button></div>
			{#if error}
				<div id="login-error" class="alert error" role="alert">{error}</div>
			{/if}
		</form>
		{#if data.signupOpen}
			<p class="soft">New label? <a href="/signup">Create an account</a></p>
		{/if}
	{/if}
</div>
