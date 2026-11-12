<!--
	shadcn-svelte Native Select: a real <select> (works before hydration, native keyboard and
	screen-reader behaviour), drawn in LabelKit's control style with its own chevron. Use it for
	short fixed lists; long searchable lists get a Combobox.
-->
<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLSelectAttributes } from 'svelte/elements';

	type NativeSelectProps = Omit<WithElementRef<HTMLSelectAttributes, HTMLSelectElement>, 'size'> & {
		size?: 'sm' | 'default';
		/** Classes for the wrapper; `class` goes on the <select>. */
		wrapperClass?: string;
	};

	let {
		ref = $bindable(null),
		value = $bindable(),
		class: className,
		wrapperClass,
		size = 'default',
		children,
		...restProps
	}: NativeSelectProps = $props();
</script>

<div
	class={cn(
		'group/native-select relative w-full has-[select:disabled]:opacity-50',
		size === 'sm' && 'w-fit',
		wrapperClass
	)}
	data-slot="native-select-wrapper"
	data-size={size}
>
	<select
		bind:value
		bind:this={ref}
		data-slot="native-select"
		data-size={size}
		class={cn(
			'w-full min-w-0 cursor-pointer appearance-none rounded-none border border-input bg-surface font-sans text-[length:inherit] text-foreground aria-invalid:border-destructive disabled:cursor-not-allowed',
			size === 'sm' ? 'min-h-8 py-0 pr-8 pl-2.5 text-[13px]' : 'min-h-11 py-0 pr-10 pl-3',
			className
		)}
		{...restProps}
	>
		{@render children?.()}
	</select>
	<svg
		class={cn(
			'pointer-events-none absolute top-1/2 size-4 -translate-y-1/2 text-muted-foreground',
			size === 'sm' ? 'right-2' : 'right-3'
		)}
		data-slot="native-select-icon"
		aria-hidden="true"
		viewBox="0 0 16 16"
		fill="none"
		stroke="currentColor"
		stroke-width="1.5"
		stroke-linecap="square"><path d="M4 6l4 4 4-4" /></svg
	>
</div>
