<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLFieldsetAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		children,
		...restProps
	}: WithElementRef<HTMLFieldsetAttributes> = $props();
</script>

<fieldset
	bind:this={ref}
	data-slot="field-set"
	class={cn('m-0 flex min-w-0 flex-col gap-3 border-0 p-0', className)}
	{...restProps}
>
	{@render children?.()}
</fieldset>
