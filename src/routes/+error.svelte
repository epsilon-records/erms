<script lang="ts">
	import { page } from '$app/state';
</script>

<div class="container">
	<section class="stack">
		<div class="eyebrow"><span class="tag outline">{page.status}</span></div>
		<h1 class="display">{page.status === 404 ? 'Not found' : 'Something went wrong'}</h1>
		{#if page.error?.message}<p class="soft" style="margin: 0">{page.error.message}</p>{/if}
		<div><a href="/" class="btn">Back to catalog</a></div>
	</section>
</div>
