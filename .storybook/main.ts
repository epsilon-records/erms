import type { StorybookConfig } from '@storybook/sveltekit';

// Storybook for the shared components in src/lib/components/ui only (EPSILON-166), not pages.
const config: StorybookConfig = {
	stories: ['../src/lib/components/ui/**/*.stories.@(svelte|ts)'],
	addons: ['@storybook/addon-svelte-csf', '@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: { name: '@storybook/sveltekit', options: {} }
};

export default config;
