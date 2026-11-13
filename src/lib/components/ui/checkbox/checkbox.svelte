<!--
	Checkbox: a styled native <input type="checkbox">, so it toggles, submits `name`/`value` and
	works with the keyboard and screen readers without JavaScript (forms here are progressively
	enhanced). Replaces the Bits UI button version, which could not be toggled before hydration
	(CodeRabbit on #118). Give it an `id` and a Label. `indeterminate` wins over `checked` visually.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLInputAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		checked = $bindable(false),
		indeterminate = $bindable(false),
		class: className,
		...restProps
	}: WithElementRef<Omit<HTMLInputAttributes, 'type'>, HTMLInputElement> & {
		indeterminate?: boolean;
	} = $props();
</script>

<span data-slot="checkbox" class={cn('relative inline-grid size-5 shrink-0', className)}>
	<input
		bind:this={ref}
		type="checkbox"
		data-slot="checkbox-input"
		bind:checked
		bind:indeterminate
		class="peer col-start-1 row-start-1 m-0 size-5 cursor-pointer appearance-none rounded-none border border-input bg-surface checked:border-accent-border checked:bg-primary indeterminate:border-accent-border indeterminate:bg-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
		{...restProps}
	/>
	<svg
		class="pointer-events-none col-start-1 row-start-1 hidden size-3.5 place-self-center text-primary-foreground peer-checked:block peer-indeterminate:hidden"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="2.25"
		stroke-linecap="square"
		aria-hidden="true"><path d="M3 8.5l3.25 3.25L13 5" /></svg
	>
	<svg
		class="pointer-events-none col-start-1 row-start-1 hidden size-3.5 place-self-center text-primary-foreground peer-indeterminate:block"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="2.25"
		stroke-linecap="square"
		aria-hidden="true"><path d="M3.5 8h9" /></svg
	>
</span>
