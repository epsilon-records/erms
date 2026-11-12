<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import { Button } from './index.js';

	// No `component` here: each story renders its own <Button>, so states are written out as markup.
	const { Story } = defineMeta({ title: 'UI/Button' });
</script>

<Story name="Default">
	<Button>Save draft</Button>
</Story>

<Story name="Primary">
	<Button variant="primary">Create release</Button>
</Story>

<Story name="Danger">
	<Button variant="danger">Remove member</Button>
</Story>

<Story name="Small">
	<Button size="small">Edit</Button>
</Story>

<Story name="Disabled">
	<Button variant="primary" disabled>Create release</Button>
</Story>

<Story name="Link">
	<Button href="/releases">All releases</Button>
</Story>

<Story name="Primary link">
	<Button href="/releases/new" variant="primary">New release</Button>
</Story>

<Story name="Danger link">
	<Button href="/releases" variant="danger">Delete</Button>
</Story>

<Story name="Long text">
	<div style="max-width: 320px">
		<Button variant="primary">Import 1,240 recordings from the Epsilon back catalogue</Button>
	</div>
</Story>
