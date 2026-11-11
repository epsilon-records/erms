<script lang="ts">
	import { page } from '$app/state';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
</script>

<div class="container" style="max-width: 480px; padding-top: 12vh">
	<section class="stack">
		<div class="eyebrow"><span>{page.data.brand?.name ?? 'LabelKit'}</span></div>
		<h1 class="display">Create an account</h1>
	</section>

	{#if !data.open}
		<div class="alert" role="status">
			Signup isn't open yet. If your label already uses LabelKit, ask an owner for an invite.
		</div>
		<p><a href="/login">Log in</a></p>
	{:else if form && 'sent' in form}
		<div class="alert ok" role="status">
			Sign-up link sent to {form.sent}. Open it to name your label.
		</div>
	{:else}
		<form method="POST" class="stack">
			<label for="email" class="eyebrow">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" required />
			<div><button class="btn primary">Send sign-up link</button></div>
			{#if form && 'error' in form}
				<div class="alert error" role="alert">{form.error}</div>
			{/if}
		</form>
		<p class="soft">Already have an account? <a href="/login">Log in</a></p>
	{/if}
</div>
