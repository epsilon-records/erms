<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import LegalPage from './LegalPage.svelte';

	const { Story } = defineMeta({ title: 'Pages/Legal page' });
</script>

<Story name="Default">
	<LegalPage title="Terms" effective="12 November 2026">
		<h2>1. Who we are</h2>
		<p>LabelKit is run by Epsilon Records in Amsterdam.</p>
		<h2>2. Your account</h2>
		<ul>
			<li>Keep your sign-in details to yourself.</li>
			<li>Tell us if you think someone else has used your account.</li>
		</ul>
	</LegalPage>
</Story>
