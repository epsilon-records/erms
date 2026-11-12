<script module lang="ts">
	import { defineMeta } from '@storybook/addon-svelte-csf';
	import Credits from './Credits.svelte';

	const credits = [
		{ id: 'c1', role: 'Producer', name: 'Ava Lind', partyId: 'p1', approvedAt: '2026-11-01' },
		{ id: 'c2', role: 'Mastering engineer', name: 'Noor de Vries', partyId: 'p2', approvedAt: null }
	];
	const roles = ['Producer', 'Composer', 'Mastering engineer', 'Remixer'] as const;

	const { Story } = defineMeta({ title: 'Recording/Credits', component: Credits });
</script>

<Story name="Read only" args={{ credits }} />
<Story name="Editable" args={{ credits, canEdit: true, canApprove: true, roles }} />
<Story name="Empty, editable" args={{ credits: [], canEdit: true, roles }} />
<Story
	name="Add form with error"
	args={{
		credits,
		canEdit: true,
		roles,
		values: { role: 'Producer' },
		errors: { party: 'Pick who this credit is for.' }
	}}
/>
