<!--
	shadcn-svelte Checkbox (Bits UI): a role="checkbox" button plus a hidden input carrying `name`
	and `value` when checked, so it submits like a native checkbox. Give it an `id` and a Label.
-->
<script lang="ts">
	import { Checkbox as CheckboxPrimitive } from 'bits-ui';
	import { cn, type WithoutChildrenOrChild } from '#lib/utils.js';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		...restProps
	}: WithoutChildrenOrChild<CheckboxPrimitive.RootProps> = $props();
</script>

<CheckboxPrimitive.Root
	bind:ref
	data-slot="checkbox"
	class={cn(
		'peer relative inline-grid size-5 shrink-0 cursor-pointer place-content-center rounded-none border border-input bg-surface p-0 text-primary-foreground after:absolute after:-inset-x-3 after:-inset-y-3 aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
		className
	)}
	bind:checked
	bind:indeterminate
	{...restProps}
>
	{#snippet children({ checked, indeterminate })}
		<span data-slot="checkbox-indicator" class="grid place-content-center text-current">
			{#if checked}
				<svg
					class="size-3.5"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="2.25"
					stroke-linecap="square"
					aria-hidden="true"><path d="M3 8.5l3.25 3.25L13 5" /></svg
				>
			{:else if indeterminate}
				<svg
					class="size-3.5"
					viewBox="0 0 16 16"
					fill="none"
					stroke="currentColor"
					stroke-width="2.25"
					aria-hidden="true"><path d="M3.5 8h9" /></svg
				>
			{/if}
		</span>
	{/snippet}
</CheckboxPrimitive.Root>
