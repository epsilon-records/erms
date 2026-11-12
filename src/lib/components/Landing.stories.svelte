<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Landing from './Landing.svelte';

	const { Story } = defineMeta({
		title: 'Pages/Landing',
		component: Landing,
		parameters: { layout: 'fullscreen' }
	});
</script>

<Story name="Sign-up open" args={{ signupOpen: true }} />
<Story name="Sign-up closed" args={{ signupOpen: false }} />
