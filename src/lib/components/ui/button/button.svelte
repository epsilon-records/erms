<!--
	shadcn-svelte Button, restyled to LabelKit's `.btn` (B+C look: square, 44 px tall, lime primary).
	Unlike a bare <button>, `type` defaults to "button": pass type="submit" in a form.
-->
<script lang="ts" module>
	import { type VariantProps, tv } from 'tailwind-variants';
	import { cn, type WithElementRef } from '#lib/utils.js';
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';

	export const buttonVariants = tv({
		base: 'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border py-0 font-sans font-semibold whitespace-nowrap no-underline select-none disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
		variants: {
			variant: {
				default:
					'border-primary bg-primary font-bold text-primary-foreground hover:text-primary-foreground hover:brightness-108',
				outline:
					'border-input bg-transparent text-foreground hover:border-foreground hover:text-strong',
				destructive:
					'border-input bg-transparent text-destructive hover:border-foreground hover:text-destructive',
				ghost:
					'border-transparent bg-transparent font-normal text-muted-foreground hover:text-strong',
				link: 'border-transparent bg-transparent font-normal text-foreground underline hover:text-strong'
			},
			size: {
				default: 'min-h-11 px-[18px] text-[15px] leading-[inherit]',
				sm: 'min-h-8 px-2.5 text-[13px] leading-[inherit]'
			}
		},
		compoundVariants: [
			{ variant: ['ghost', 'link'], size: ['default', 'sm'], class: 'min-h-0 px-0' }
		],
		defaultVariants: {
			variant: 'default',
			size: 'default'
		}
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = WithElementRef<HTMLButtonAttributes> &
		WithElementRef<HTMLAnchorAttributes> & {
			variant?: ButtonVariant;
			size?: ButtonSize;
		};
</script>

<script lang="ts">
	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...restProps
	}: ButtonProps = $props();
</script>

{#if href}
	<a
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		href={disabled ? undefined : href}
		aria-disabled={disabled}
		role={disabled ? 'link' : undefined}
		tabindex={disabled ? -1 : undefined}
		{...restProps}
	>
		{@render children?.()}
	</a>
{:else}
	<button
		bind:this={ref}
		data-slot="button"
		class={cn(buttonVariants({ variant, size }), className)}
		{type}
		{disabled}
		{...restProps}
	>
		{@render children?.()}
	</button>
{/if}
