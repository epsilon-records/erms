<!--
	shadcn-svelte Field: one label, its control, an optional description and error.
	`responsive` is LabelKit's two-column form row (the old `.form-grid`): a 140 px label column
	beside a control of up to 480 px, stacked below 640 px.
-->
<script lang="ts" module>
	import { tv, type VariantProps } from 'tailwind-variants';

	export const fieldVariants = tv({
		base: 'group/field flex w-full gap-1.5 data-[invalid=true]:text-destructive',
		variants: {
			orientation: {
				vertical: 'flex-col',
				horizontal:
					'flex-row items-center gap-3 *:data-[slot=field-label]:flex-auto *:data-[slot=field-label]:text-[15px] *:data-[slot=field-label]:text-foreground',
				responsive:
					'flex-col sm:grid sm:grid-cols-[140px_minmax(0,480px)] sm:items-center sm:gap-x-5 sm:gap-y-1.5 sm:*:not-data-[slot=field-label]:col-start-2'
			}
		},
		defaultVariants: {
			orientation: 'vertical'
		}
	});

	export type FieldOrientation = VariantProps<typeof fieldVariants>['orientation'];
</script>

<script lang="ts">
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAttributes } from 'svelte/elements';

	let {
		ref = $bindable(null),
		class: className,
		orientation = 'vertical',
		children,
		...restProps
	}: WithElementRef<HTMLAttributes<HTMLDivElement>> & {
		orientation?: FieldOrientation;
	} = $props();
</script>

<div
	bind:this={ref}
	role="group"
	data-slot="field"
	data-orientation={orientation}
	class={cn(fieldVariants({ orientation }), className)}
	{...restProps}
>
	{@render children?.()}
</div>
