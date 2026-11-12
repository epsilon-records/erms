import type { StorybookConfig } from '@storybook/sveltekit';

// The Epsilon Storybook hub at storybook.epsilonrecords.com (shared 0064, 0065): one welcome page,
// then the products' published Storybooks in one sidebar (Storybook composition). Each product
// must send Access-Control-Allow-Origin for this origin. Add AudioKit once storybook.audiokit.ai is
// live; a ref to an address that doesn't answer shows an error in the sidebar.
const config: StorybookConfig = {
	stories: ['../../src/storybook-hub/*.stories.svelte'],
	addons: ['@storybook/addon-svelte-csf'],
	framework: { name: '@storybook/sveltekit', options: {} },
	// The Svelte plugin comes from the app's Vite config; from this folder Storybook wouldn't find it.
	core: {
		builder: { name: '@storybook/builder-vite', options: { viteConfigPath: 'vite.config.ts' } }
	},
	refs: {
		labelkit: { title: 'LabelKit', url: 'https://storybook.labelkit.co' }
	}
};

export default config;
