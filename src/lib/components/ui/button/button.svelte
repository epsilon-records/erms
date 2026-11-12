<script lang="ts" module>
	import type { HTMLAnchorAttributes, HTMLButtonAttributes } from 'svelte/elements';
	import { tv, type VariantProps } from 'tailwind-variants';

	/** Mirrors the existing `.btn` look (44 px touch target, square, Plex 600) so pages can move over one by one. */
	export const buttonVariants = tv({
		base: 'inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 border font-sans font-semibold whitespace-nowrap no-underline transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50',
		variants: {
			variant: {
				default:
					'border-border-strong bg-transparent text-foreground hover:border-foreground hover:text-strong',
				primary:
					'border-accent bg-accent font-bold text-on-accent hover:brightness-108 hover:text-on-accent',
				danger:
					'border-border-strong bg-transparent text-danger hover:border-danger hover:text-danger',
				ghost: 'border-transparent bg-transparent text-foreground hover:text-strong'
			},
			size: {
				default: 'min-h-11 px-[18px] text-[15px]',
				small: 'min-h-8 px-2.5 text-[13px]'
			}
		},
		defaultVariants: { variant: 'default', size: 'default' }
	});

	export type ButtonVariant = VariantProps<typeof buttonVariants>['variant'];
	export type ButtonSize = VariantProps<typeof buttonVariants>['size'];

	export type ButtonProps = (HTMLButtonAttributes & HTMLAnchorAttributes) & {
		variant?: ButtonVariant;
		size?: ButtonSize;
		ref?: HTMLElement | null;
	};
</script>

<script lang="ts">
	import { cn } from '#lib/utils.js';

	let {
		class: className,
		variant = 'default',
		size = 'default',
		ref = $bindable(null),
		href = undefined,
		type = 'button',
		disabled,
		children,
		...rest
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
		{...rest}
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
		{...rest}
	>
		{@render children?.()}
	</button>
{/if}
