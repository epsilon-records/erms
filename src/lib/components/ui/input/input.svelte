<!--
	shadcn-svelte Input in LabelKit's control style: 44 px, square, surface fill. `aria-invalid`
	turns the border red; pair it with aria-describedby pointing at the Field.Error.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLInputAttributes, HTMLInputTypeAttribute } from 'svelte/elements';

	type InputType = Exclude<HTMLInputTypeAttribute, 'file'>;

	type Props = WithElementRef<
		Omit<HTMLInputAttributes, 'type'> &
			({ type: 'file'; files?: FileList } | { type?: InputType; files?: undefined })
	>;

	let {
		ref = $bindable(null),
		value = $bindable(),
		type,
		files = $bindable(),
		class: className,
		'data-slot': dataSlot = 'input',
		...restProps
	}: Props = $props();

	const base =
		'min-h-11 w-full min-w-0 rounded-none border border-input bg-surface px-3 font-sans text-[length:inherit] text-foreground placeholder:text-placeholder aria-invalid:border-destructive disabled:cursor-not-allowed disabled:opacity-50';
</script>

{#if type === 'file'}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(
			base,
			'py-[9px] file:mr-3 file:border-0 file:bg-transparent file:font-sans file:font-semibold file:text-foreground',
			className
		)}
		type="file"
		bind:files
		bind:value
		{...restProps}
	/>
{:else}
	<input
		bind:this={ref}
		data-slot={dataSlot}
		class={cn(base, className)}
		{type}
		bind:value
		{...restProps}
	/>
{/if}
