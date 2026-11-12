import type { StorybookConfig } from '@storybook/sveltekit';

// Storybook for every visual component in src/lib (EPSILON-166). PublicAnalytics and AppMetrics
// render nothing, so they have no stories.
const config: StorybookConfig = {
	stories: ['../src/lib/**/*.stories.@(svelte|ts)'],
	addons: ['@storybook/addon-svelte-csf', '@storybook/addon-a11y', '@storybook/addon-vitest'],
	framework: { name: '@storybook/sveltekit', options: {} }
};

export default config;
