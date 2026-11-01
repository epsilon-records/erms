<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

<div class="container" style="max-width: 480px; padding-top: 12vh">
	<section class="stack">
		<div class="eyebrow"><span>Epsilon Records</span></div>
		<h1 class="display">Log in</h1>
	</section>

	{#if form && 'sent' in form}
		<div class="alert ok" role="status">
			Login link sent to {form.sent}. Check your inbox.
		</div>
	{:else}
		<form method="POST" class="stack">
			<label for="email" class="eyebrow">Email</label>
			<input id="email" name="email" type="email" autocomplete="email" required />
			<div><button class="btn primary">Send login link</button></div>
			{#if form && 'error' in form}
				<div class="alert error" role="alert">{form.error}</div>
			{/if}
		</form>
	{/if}
</div>
