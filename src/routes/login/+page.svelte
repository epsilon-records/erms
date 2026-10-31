<script lang="ts">
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();
</script>

{#if form && 'sent' in form}
	<pre>
&gt; Login link sent to {form.sent}
&gt; Check your inbox.</pre>
{:else}
	<form method="POST">
		<pre>&gt; LOGIN</pre>
		<label>
			email: <input name="email" type="email" autocomplete="email" required />
		</label>
		<button>[ send link ]</button>
		{#if form && 'error' in form}
			<pre class="err">! {form.error}</pre>
		{/if}
	</form>
{/if}

<style>
	.err {
		color: #ff6b6b;
	}
</style>
