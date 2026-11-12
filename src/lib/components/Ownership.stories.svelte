<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Ownership from './Ownership.svelte';

	// Shaped like the server's data: territory codes (WW shows as "Worldwide") and holders as
	// l:<label id> or p:<party id>, which is what the holder selects post.
	const groups = [
		{
			territory: 'WW',
			holders: [
				{ holder: 'l:l1', name: 'Epsilon Records', isLabel: true, share: '70' },
				{ holder: 'p:p1', name: 'Ava Lind', isLabel: false, share: '30' }
			]
		},
		{
			territory: 'NL',
			holders: [{ holder: 'l:l1', name: 'Epsilon Records', isLabel: true, share: '100' }]
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

<Story name="Read only" args={{ groups, action: 'setMaster' }} />
<Story name="Editable" args={{ groups, options, action: 'setMaster' }} />
<Story name="Saved" args={{ groups, options, action: 'setMaster', saved: true }} />
<Story name="Empty" args={{ groups: [], options, action: 'setMaster' }} />
<Story
	name="Shares over 100%"
	args={{
		groups,
		options,
		action: 'setMaster',
		errors: { shares: 'WW total 110%, not 100%' },
		values: {
			territory: 'WW',
			holder_0: 'l:l1',
			share_0: '70',
			holder_1: 'p:p1',
			share_1: '40'
		}
	}}
/>
