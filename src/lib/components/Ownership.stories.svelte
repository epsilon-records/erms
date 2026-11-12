<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Ownership from './Ownership.svelte';

	const groups = [
		{
			territory: 'Worldwide',
			holders: [
				{ holder: 'l1', name: 'Epsilon Records', isLabel: true, share: '70' },
				{ holder: 'p1', name: 'Ava Lind', isLabel: false, share: '30' }
			]
		},
		{
			territory: 'NL',
			holders: [{ holder: 'l1', name: 'Epsilon Records', isLabel: true, share: '100' }]
		}
	];
	const options = {
		labels: [{ id: 'l1', name: 'Epsilon Records' }],
		parties: [
			{ id: 'p1', name: 'Ava Lind' },
			{ id: 'p2', name: 'Noor de Vries' }
		]
	};

	const { Story } = defineMeta({ title: 'Recording/Ownership', component: Ownership });
</script>

<Story name="Read only" args={{ groups, action: '?/ownership' }} />
<Story name="Editable" args={{ groups, options, action: '?/ownership' }} />
<Story name="Saved" args={{ groups, options, action: '?/ownership', saved: true }} />
<Story name="Empty" args={{ groups: [], options, action: '?/ownership' }} />
<Story
	name="Shares over 100%"
	args={{
		groups,
		options,
		action: '?/ownership',
		errors: { shares: 'Shares for a territory must total 100%.' }
	}}
/>
