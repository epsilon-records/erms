<!--
	A field's error message. Renders nothing without one. Give it an `id` and point the control's
	aria-describedby at it, with aria-invalid on the control.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { Snippet } from 'svelte';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		errors,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		children?: Snippet;
		errors?: ({ message?: string } | undefined)[];
	} = $props();

	const messages = $derived((errors ?? []).map((e) => e?.message).filter((m): m is string => !!m));
</script>

{#if children || messages.length}
	<div
		bind:this={ref}
		role="alert"
		data-slot="field-error"
		class={cn('text-[13px] text-destructive', className)}
		{...restProps}
	>
		{#if children}
			{@render children()}
		{:else if messages.length === 1}
			{messages[0]}
		{:else}
			<ul class="m-0 flex list-disc flex-col gap-1 pl-4">
				{#each messages as message, i (i)}<li>{message}</li>{/each}
			</ul>
		{/if}
	</div>
{/if}
