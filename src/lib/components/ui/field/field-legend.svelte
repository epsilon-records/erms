<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLLegendElement>> = $props();
</script>

<legend
	bind:this={ref}
	data-slot="field-legend"
	class={cn('mb-1 p-0 text-[13px] text-muted-foreground', className)}
	{...restProps}
>
	{@render children?.()}
</legend>
